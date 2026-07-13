// server.js - 로비 + 대기실(READY 게이트) + 덱 동기 (v5)
//   [N-1] 변경 요약
//     · joinRoom → 즉시 gameStart 금지. 대기실(readyRoom)로 보낸다.
//     · 신규 이벤트: roomJoined / deck / deckUpdate / ready / readyUpdate / leaveReady / enemyLeftRoom / versionMismatch
//     · 신규 채널: relay — rngOffset 을 건드리지 않는 순수 중계(D-07)
//     · gameStart 는 "양측 READY && 양측 char 존재 && 테이블 ver 일치" 일 때만 방출.
//       페이로드에 myDeck/enemyDeck 을 모두 실어 보낸다(D-01/02/03/05 종결의 열쇠).
//   기존 action / chat / rejoin / disconnect 핸들러는 일절 미변경(순수 추가).
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Render.com 슬립 방지
app.get('/ping', (req, res) => res.sendStatus(200));

// 대기 중인 방 목록(아직 상대 없음)
// { roomId: { hostSocket, hostDeck, name, password, createdAt } }
let waitingRooms = {};

// [N-1] 대기실 — 두 명이 모였지만 아직 시작 전
// { readyRoomID: { roomId, name, hostSocket, guestSocket, decks:{p1,p2}, ready:{p1,p2} } }
let readyRooms = {};

// 게임별 RNG 호출 횟수 추적 — rejoin 시 offset 복원용
let gameStates = {};

function broadcastRoomList() {
    io.to('lobby').emit('roomListUpdate', getRoomList());
}

function broadcastLobbyStats() {
    io.to('lobby').emit('lobbyStats', {
        online: io.sockets.sockets.size,
        rooms:  Object.keys(waitingRooms).length
    });
}

function getRoomList() {
    return Object.entries(waitingRooms).map(([id, room]) => ({
        id,
        name: room.name,
        hasPassword: !!room.password,
        createdAt: room.createdAt,
        // [U-2] 로비 정보량 — 목록에서 맵/모드를 보고 들어갈 수 있게
        map:  (room.hostDeck && room.hostDeck.map)  || null,
        dur:  (room.hostDeck && room.hostDeck.dur)  || null
    }));
}

function _rrOf(socket) {
    return socket.readyRoomID ? readyRooms[socket.readyRoomID] : null;
}

io.on('connection', (socket) => {
    console.log('✅ 접속:', socket.id);
    broadcastLobbyStats();

    socket.on('enterLobby', () => {
        socket.join('lobby');
        socket.emit('roomList', getRoomList());
        broadcastLobbyStats();
    });

    socket.on('leaveLobby', () => { socket.leave('lobby'); });

    socket.on('createRoom', (data) => {
        if (socket.waitingRoomId && waitingRooms[socket.waitingRoomId]) {
            delete waitingRooms[socket.waitingRoomId];
            broadcastRoomList();
        }
        const name = ((data && data.name) || '').trim() || '대결 신청';
        const password = ((data && data.password) || '').trim();
        const roomId = `room_${socket.id}_${Date.now()}`;

        socket.deck = data.deck;
        socket.waitingRoomId = roomId;

        waitingRooms[roomId] = {
            hostSocket: socket, hostDeck: data.deck,
            name, password, createdAt: Date.now()
        };

        socket.emit('roomCreated', { roomId, name });
        broadcastRoomList();
        broadcastLobbyStats();
        console.log(`🏠 방 개설: [${name}] (${roomId}, PW:${password ? 'Y' : 'N'})`);
    });

    // ── [N-1] joinRoom = 대기실 진입. gameStart 방출하지 않는다. ──────────────
    socket.on('joinRoom', (data) => {
        const { roomId, password, deck } = data || {};
        const room = waitingRooms[roomId];

        if (!room) { socket.emit('roomNotFound'); return; }
        if (room.password && room.password !== ((password || '').trim())) {
            socket.emit('wrongPassword'); return;
        }

        delete waitingRooms[roomId];
        broadcastRoomList();
        broadcastLobbyStats();

        const host = room.hostSocket;
        const readyRoomID = `ready_${roomId}_${Date.now()}`;

        host.join(readyRoomID);
        socket.join(readyRoomID);

        host.readyRoomID   = readyRoomID;  host.gameRole   = 'player1';  host.waitingRoomId = null;
        socket.readyRoomID = readyRoomID;  socket.gameRole = 'player2';

        readyRooms[readyRoomID] = {
            roomId, name: room.name,
            hostSocket: host, guestSocket: socket,
            decks: { p1: room.hostDeck || null, p2: deck || null },
            ready: { p1: false, p2: false }
        };

        io.to(host.id).emit('roomJoined',   { role:'player1', room:readyRoomID, name:room.name, enemyDeck: deck || null });
        io.to(socket.id).emit('roomJoined', { role:'player2', room:readyRoomID, name:room.name, enemyDeck: room.hostDeck || null });

        console.log(`🚪 대기실 개설: ${readyRoomID}`);
    });

    // ── [N-1] 덱 확정(캐릭터 선택 완료) ─────────────────────────────────────
    socket.on('deck', (d) => {
        const rr = _rrOf(socket); if (!rr || !d || !d.deck) return;
        const me = (socket.gameRole === 'player2') ? 'p2' : 'p1';
        rr.decks[me] = d.deck;
        // 덱이 바뀌면 준비 해제 — "다른 캐릭터로 바꿔놓고 시작" 방지
        rr.ready[me] = false;
        io.to(socket.readyRoomID).emit('deckUpdate', { role: socket.gameRole, deck: d.deck });
        io.to(socket.readyRoomID).emit('readyUpdate', { p1: rr.ready.p1, p2: rr.ready.p2 });
    });

    // ── [N-1] 준비 토글 → 조건 충족 시에만 gameStart ─────────────────────────
    socket.on('ready', (d) => {
        const rr = _rrOf(socket); if (!rr) return;
        const me = (socket.gameRole === 'player2') ? 'p2' : 'p1';
        rr.ready[me] = !!(d && d.v);
        io.to(socket.readyRoomID).emit('readyUpdate', { p1: rr.ready.p1, p2: rr.ready.p2 });

        const d1 = rr.decks.p1, d2 = rr.decks.p2;
        const okDeck = d1 && d1.char && d2 && d2.char;
        if (!(rr.ready.p1 && rr.ready.p2 && okDeck)) return;

        // 테이블(캐릭터 밸런스) 버전 불일치 = 조용한 데미지 불일치보다 매치 거부가 낫다
        if (d1.ver != null && d2.ver != null && d1.ver !== d2.ver) {
            rr.ready.p1 = rr.ready.p2 = false;
            io.to(socket.readyRoomID).emit('versionMismatch');
            io.to(socket.readyRoomID).emit('readyUpdate', { p1:false, p2:false });
            console.log(`⛔ 버전 불일치: ${d1.ver} vs ${d2.ver}`);
            return;
        }

        const gameRoomID = `game_${socket.readyRoomID}_${Date.now()}`;
        const seed = Math.floor(Math.random() * 2147483646) + 1;
        const host = rr.hostSocket, guest = rr.guestSocket;

        [host, guest].forEach(s => {
            if (!s) return;
            s.join(gameRoomID);
            s.gameRoomID = gameRoomID;
            s.readyRoomID = null;
        });
        gameStates[gameRoomID] = { seed, rngOffset: 0 };

        // ★ 양측 덱 전부 송신 — 클라가 gsChars[0], gsChars[1] 을 모두 채운다
        if (host)  io.to(host.id).emit('gameStart',  { role:'player1', room:gameRoomID, seed, myDeck:d1, enemyDeck:d2 });
        if (guest) io.to(guest.id).emit('gameStart', { role:'player2', room:gameRoomID, seed, myDeck:d2, enemyDeck:d1 });

        delete readyRooms[Object.keys(readyRooms).find(k => readyRooms[k] === rr)];
        console.log(`⚔️ 매치 시작 (${gameRoomID})`);
    });

    // ── [N-1] 대기실 이탈 ───────────────────────────────────────────────────
    socket.on('leaveReady', () => { _dissolveReady(socket, '상대가 대기실을 나갔어요'); });

    function _dissolveReady(sock, msg) {
        const id = sock.readyRoomID; const rr = id && readyRooms[id];
        if (!rr) return;
        const other = (rr.hostSocket === sock) ? rr.guestSocket : rr.hostSocket;
        if (other) { other.leave(id); other.readyRoomID = null; other.emit('enemyLeftRoom', { msg }); }
        sock.leave(id); sock.readyRoomID = null;
        delete readyRooms[id];
        console.log(`🚪 대기실 해체: ${id}`);
    }

    socket.on('cancelRoom', () => {
        if (socket.waitingRoomId && waitingRooms[socket.waitingRoomId]) {
            delete waitingRooms[socket.waitingRoomId];
            socket.waitingRoomId = null;
            broadcastRoomList();
            broadcastLobbyStats();
        }
    });

    // ── [신규] 순수 릴레이 — 상태/카운터 무접촉 (D-07 회피용 예비 채널) ──────
    socket.on('relay', (d) => {
        if (!d || !d.room) return;
        socket.to(d.room).emit('relay', d);
    });

    // ── 기존 게임 채널(미변경) ───────────────────────────────────────────────
    socket.on('action', (data) => {
        if (data && data.room && gameStates[data.room]) gameStates[data.room].rngOffset++;
        socket.to(data.room).emit('enemyAction', data);
    });

    socket.on('chat', (data) => {
        const { room, quickIdx } = data || {};
        if (!room || quickIdx == null) return;
        if (typeof quickIdx !== 'number' || quickIdx < 0 || quickIdx > 7) return;
        socket.to(room).emit('chat', { from: socket.id, quickIdx });
    });

    socket.on('rejoin', (data) => {
        const { room, role } = data || {};
        if (!room) return;
        socket.join(room);
        socket.gameRoomID = room;
        socket.gameRole = role;
        socket.to(room).emit('enemyRejoined', { role });
        const state = gameStates[room];
        socket.emit('rejoinOk', state ? { seed: state.seed, rngOffset: state.rngOffset } : {});
    });

    socket.on('disconnect', () => {
        console.log('❌ 연결 종료:', socket.id);

        if (socket.waitingRoomId && waitingRooms[socket.waitingRoomId]) {
            delete waitingRooms[socket.waitingRoomId];
            broadcastRoomList();
        }
        if (socket.readyRoomID) _dissolveReady(socket, '상대의 연결이 끊겼어요');

        if (socket.gameRoomID && gameStates[socket.gameRoomID]) {
            const room = socket.gameRoomID;
            setTimeout(() => {
                const s = io.sockets.adapter.rooms.get(room);
                if (!s || s.size === 0) { delete gameStates[room]; console.log(`🗑️ gameState 정리: ${room}`); }
            }, 30000);
        }

        for (const room of socket.rooms) {
            if (room !== socket.id) socket.to(room).emit('enemyDisconnect');
        }
        broadcastLobbyStats();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
