<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>🌍 Globe Striker - Territory Battle</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Fredoka+One&family=DM+Sans:wght@400;500;700;900&display=swap');
        
        :root {
            /* Colors */
            --player1-color: #FF4757;
            --player2-color: #5352ED;
            --ocean: #67C7E3;
            --forest: #72D27E;
            --bg-primary: #FFF5F7;
            --bg-dark: rgba(0, 0, 0, 0.7);
            --text-dark: #2D3436;
            --text-light: #636E72;
            --white: #FFFFFF;
            
            /* Fonts */
            --font-display: 'Fredoka One', cursive;
            --font-body: 'DM Sans', sans-serif;
            
            /* Animation */
            --bounce: cubic-bezier(0.68, -0.55, 0.265, 1.55);
            --ease-out: cubic-bezier(0.33, 1, 0.68, 1);
        }
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            overflow: hidden;
            user-select: none;
            font-family: var(--font-body);
            background: radial-gradient(ellipse at top, #FFE5EC 0%, #C7F0FF 100%);
            position: relative;
            touch-action: manipulation;
        }
        
        /* ================================
           TOP BAR - Game Status
        ================================ */
        #top-bar {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 70px;
            background: linear-gradient(to bottom, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0.85));
            backdrop-filter: blur(10px);
            box-shadow: 0 2px 20px rgba(0, 0, 0, 0.1);
            z-index: 100;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 20px;
        }
        
        .player-info {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        
        .player-avatar {
            width: 45px;
            height: 45px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
            border: 3px solid;
            transition: all 0.3s var(--bounce);
        }
        
        .player-avatar.p1 {
            background: linear-gradient(135deg, var(--player1-color), #E84057);
            border-color: var(--player1-color);
        }
        
        .player-avatar.p2 {
            background: linear-gradient(135deg, var(--player2-color), #3742FA);
            border-color: var(--player2-color);
        }
        
        .player-avatar.active {
            transform: scale(1.15);
            box-shadow: 0 0 20px currentColor;
            animation: pulse 1.5s infinite;
        }
        
        @keyframes pulse {
            0%, 100% { box-shadow: 0 0 20px currentColor; }
            50% { box-shadow: 0 0 35px currentColor; }
        }
        
        .player-stats {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        
        .player-name {
            font-weight: 700;
            font-size: 14px;
            color: var(--text-dark);
        }
        
        .player-territory {
            font-size: 12px;
            color: var(--text-light);
            font-weight: 600;
        }
        
        .game-timer {
            text-align: center;
        }
        
        .timer-label {
            font-size: 10px;
            color: var(--text-light);
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .timer-value {
            font-family: var(--font-display);
            font-size: 24px;
            color: var(--text-dark);
        }
        
        /* ================================
           BOTTOM CONTROLS
        ================================ */
        #bottom-controls {
            position: absolute;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            gap: 12px;
            z-index: 100;
        }
        
        .control-btn {
            width: 60px;
            height: 60px;
            border-radius: 50%;
            border: none;
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.15);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
            cursor: pointer;
            transition: all 0.2s var(--bounce);
            touch-action: manipulation;
        }
        
        .control-btn:hover {
            transform: translateY(-4px);
            box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
        }
        
        .control-btn:active {
            transform: translateY(0) scale(0.95);
        }
        
        .control-btn.primary {
            width: 80px;
            height: 80px;
            background: linear-gradient(135deg, var(--player1-color), #E84057);
            color: white;
            font-size: 32px;
            box-shadow: 
                0 6px 0 #C92A2A,
                0 10px 25px rgba(255, 71, 87, 0.4);
        }
        
        .control-btn.primary:hover {
            box-shadow: 
                0 8px 0 #C92A2A,
                0 14px 30px rgba(255, 71, 87, 0.5);
        }
        
        .control-btn.primary:active {
            box-shadow: 
                0 2px 0 #C92A2A,
                0 6px 15px rgba(255, 71, 87, 0.4);
            transform: translateY(4px) scale(0.95);
        }
        
        /* ================================
           SIDE PANELS
        ================================ */
        .side-panel {
            position: absolute;
            top: 90px;
            width: 280px;
            max-height: calc(100vh - 200px);
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(20px);
            border-radius: 20px;
            padding: 20px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
            z-index: 90;
            overflow-y: auto;
        }
        
        #stats-panel {
            left: 20px;
        }
        
        #options-panel {
            right: 20px;
        }
        
        .panel-title {
            font-family: var(--font-display);
            font-size: 18px;
            color: var(--text-dark);
            margin-bottom: 16px;
            text-align: center;
        }
        
        .stat-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 0;
            border-bottom: 1px solid rgba(0, 0, 0, 0.05);
        }
        
        .stat-label {
            font-size: 13px;
            color: var(--text-light);
            font-weight: 600;
        }
        
        .stat-value {
            font-size: 15px;
            color: var(--text-dark);
            font-weight: 700;
        }
        
        .option-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 0;
        }
        
        .option-label {
            font-size: 14px;
            color: var(--text-dark);
            font-weight: 600;
        }
        
        /* Toggle Switch */
        .toggle-switch {
            width: 50px;
            height: 28px;
            background: #DDD;
            border-radius: 14px;
            position: relative;
            cursor: pointer;
            transition: background 0.3s;
        }
        
        .toggle-switch.active {
            background: var(--player1-color);
        }
        
        .toggle-knob {
            width: 22px;
            height: 22px;
            background: white;
            border-radius: 50%;
            position: absolute;
            top: 3px;
            left: 3px;
            transition: transform 0.3s var(--bounce);
            box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
        }
        
        .toggle-switch.active .toggle-knob {
            transform: translateX(22px);
        }
        
        /* Volume Slider */
        .volume-slider {
            width: 100%;
            height: 6px;
            background: #DDD;
            border-radius: 3px;
            position: relative;
            cursor: pointer;
            margin-top: 8px;
        }
        
        .volume-fill {
            height: 100%;
            background: linear-gradient(90deg, var(--player1-color), var(--player2-color));
            border-radius: 3px;
            width: 70%;
            transition: width 0.1s;
        }
        
        /* ================================
           TURN INDICATOR
        ================================ */
        #turn-indicator {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.85);
            backdrop-filter: blur(10px);
            padding: 30px 50px;
            border-radius: 20px;
            z-index: 200;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.3s;
        }
        
        #turn-indicator.show {
            opacity: 1;
            animation: bounceIn 0.6s var(--bounce);
        }
        
        @keyframes bounceIn {
            0% { transform: translate(-50%, -50%) scale(0.3); }
            50% { transform: translate(-50%, -50%) scale(1.1); }
            100% { transform: translate(-50%, -50%) scale(1); }
        }
        
        .turn-text {
            font-family: var(--font-display);
            font-size: 48px;
            color: white;
            text-align: center;
            text-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        }
        
        /* ================================
           GAME OVER SCREEN
        ================================ */
        #game-over {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.9);
            z-index: 300;
            display: none;
            align-items: center;
            justify-content: center;
        }
        
        #game-over.show {
            display: flex;
            animation: fadeIn 0.5s;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        
        .game-over-content {
            background: white;
            border-radius: 30px;
            padding: 50px;
            text-align: center;
            max-width: 500px;
            animation: slideUp 0.6s var(--bounce);
        }
        
        @keyframes slideUp {
            from {
                opacity: 0;
                transform: translateY(50px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        .game-over-title {
            font-family: var(--font-display);
            font-size: 48px;
            margin-bottom: 20px;
        }
        
        .game-over-winner {
            font-size: 24px;
            font-weight: 700;
            margin-bottom: 30px;
        }
        
        .game-over-stats {
            display: flex;
            justify-content: space-around;
            margin-bottom: 30px;
        }
        
        .final-stat {
            text-align: center;
        }
        
        .final-stat-label {
            font-size: 14px;
            color: var(--text-light);
            margin-bottom: 8px;
        }
        
        .final-stat-value {
            font-family: var(--font-display);
            font-size: 32px;
        }
        
        .restart-btn {
            background: linear-gradient(135deg, var(--player1-color), #E84057);
            color: white;
            border: none;
            padding: 18px 50px;
            border-radius: 50px;
            font-family: var(--font-display);
            font-size: 20px;
            cursor: pointer;
            box-shadow: 0 6px 0 #C92A2A;
            transition: all 0.2s;
        }
        
        .restart-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 0 #C92A2A;
        }
        
        .restart-btn:active {
            transform: translateY(2px);
            box-shadow: 0 2px 0 #C92A2A;
        }
        
        /* ================================
           POWER GAUGE (In-game)
        ================================ */
        #power-gauge {
            position: absolute;
            bottom: 110px;
            left: 50%;
            transform: translateX(-50%);
            width: 300px;
            opacity: 0;
            transition: opacity 0.3s;
            z-index: 95;
            pointer-events: none;
        }
        
        #power-gauge.visible {
            opacity: 1;
        }
        
        .gauge-label {
            text-align: center;
            font-weight: 700;
            font-size: 12px;
            color: var(--text-dark);
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .gauge-bar {
            height: 16px;
            background: rgba(0, 0, 0, 0.1);
            border-radius: 50px;
            overflow: hidden;
            box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.2);
        }
        
        .gauge-fill {
            height: 100%;
            width: 0%;
            background: linear-gradient(90deg, #72D27E 0%, #FFD98E 50%, #FF4757 100%);
            border-radius: 50px;
            transition: width 0.1s;
        }
        
        /* ================================
           LOADING
        ================================ */
        #loading {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(135deg, #FFE5EC 0%, #C7F0FF 100%);
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 1000;
            transition: opacity 0.5s;
        }
        
        #loading.hidden {
            opacity: 0;
            pointer-events: none;
        }
        
        .spinner {
            width: 60px;
            height: 60px;
            border: 6px solid rgba(255, 255, 255, 0.3);
            border-top-color: var(--player1-color);
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-bottom: 20px;
        }
        
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        
        .loading-text {
            font-family: var(--font-display);
            font-size: 24px;
            color: var(--text-dark);
        }
        
        /* ================================
           RESPONSIVE
        ================================ */
        @media (max-width: 768px) {
            .side-panel {
                width: calc(100% - 40px);
                max-width: 350px;
            }
            
            #stats-panel, #options-panel {
                left: 50%;
                transform: translateX(-50%);
                display: none;
            }
            
            #stats-panel.show, #options-panel.show {
                display: block;
            }
        }
    </style>
    
    <script type="importmap">
        {
            "imports": {
                "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
                "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/",
                "cannon-es": "https://unpkg.com/cannon-es@0.20.0/dist/cannon-es.js"
            }
        }
    </script>
</head>
<body>
    <!-- Loading Screen -->
    <div id="loading">
        <div class="spinner"></div>
        <div class="loading-text">Loading Globe Striker...</div>
    </div>
    
    <!-- Top Bar -->
    <div id="top-bar">
        <div class="player-info">
            <div class="player-avatar p1 active" id="avatar-p1">🔴</div>
            <div class="player-stats">
                <div class="player-name">Player 1</div>
                <div class="player-territory">Territory: <span id="territory-p1">0%</span></div>
            </div>
        </div>
        
        <div class="game-timer">
            <div class="timer-label">Time Left</div>
            <div class="timer-value" id="timer">3:00</div>
        </div>
        
        <div class="player-info">
            <div class="player-stats" style="text-align: right;">
                <div class="player-name">Player 2</div>
                <div class="player-territory">Territory: <span id="territory-p2">0%</span></div>
            </div>
            <div class="player-avatar p2" id="avatar-p2">🔵</div>
        </div>
    </div>
    
    <!-- Stats Panel -->
    <div id="stats-panel" class="side-panel">
        <div class="panel-title">📊 Game Stats</div>
        <div class="stat-item">
            <span class="stat-label">Turn</span>
            <span class="stat-value" id="stat-turn">1</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">P1 Shots</span>
            <span class="stat-value" id="stat-p1-shots">0</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">P2 Shots</span>
            <span class="stat-value" id="stat-p2-shots">0</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">P1 Distance</span>
            <span class="stat-value" id="stat-p1-distance">0 km</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">P2 Distance</span>
            <span class="stat-value" id="stat-p2-distance">0 km</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Collisions</span>
            <span class="stat-value" id="stat-collisions">0</span>
        </div>
    </div>
    
    <!-- Options Panel -->
    <div id="options-panel" class="side-panel">
        <div class="panel-title">⚙️ Settings</div>
        
        <div class="option-row">
            <span class="option-label">🔊 Sound</span>
            <div class="toggle-switch active" id="toggle-sound">
                <div class="toggle-knob"></div>
            </div>
        </div>
        
        <div class="option-row" style="flex-direction: column; align-items: flex-start;">
            <span class="option-label">🎵 Volume</span>
            <div class="volume-slider" id="volume-slider">
                <div class="volume-fill" id="volume-fill"></div>
            </div>
        </div>
        
        <div class="option-row">
            <span class="option-label">🌀 Camera Rotation</span>
            <div class="toggle-switch active" id="toggle-rotation">
                <div class="toggle-knob"></div>
            </div>
        </div>
        
        <div class="option-row">
            <span class="option-label">📍 Show Trails</span>
            <div class="toggle-switch active" id="toggle-trails">
                <div class="toggle-knob"></div>
            </div>
        </div>
    </div>
    
    <!-- Power Gauge -->
    <div id="power-gauge">
        <div class="gauge-label">SHOT POWER</div>
        <div class="gauge-bar">
            <div class="gauge-fill" id="power-fill"></div>
        </div>
    </div>
    
    <!-- Bottom Controls -->
    <div id="bottom-controls">
        <button class="control-btn" id="btn-stats" title="Stats">📊</button>
        <button class="control-btn" id="btn-options" title="Options">⚙️</button>
        <button class="control-btn primary" id="btn-shoot" title="End Turn">🚀</button>
        <button class="control-btn" id="btn-reset" title="Reset">🔄</button>
        <button class="control-btn" id="btn-help" title="Help">❓</button>
    </div>
    
    <!-- Turn Indicator -->
    <div id="turn-indicator">
        <div class="turn-text" id="turn-text">Player 1's Turn</div>
    </div>
    
    <!-- Game Over -->
    <div id="game-over">
        <div class="game-over-content">
            <div class="game-over-title">🎉 Game Over!</div>
            <div class="game-over-winner" id="winner-text">Player 1 Wins!</div>
            <div class="game-over-stats">
                <div class="final-stat">
                    <div class="final-stat-label">Player 1</div>
                    <div class="final-stat-value" style="color: var(--player1-color);" id="final-p1">45%</div>
                </div>
                <div class="final-stat">
                    <div class="final-stat-label">Player 2</div>
                    <div class="final-stat-value" style="color: var(--player2-color);" id="final-p2">38%</div>
                </div>
            </div>
            <button class="restart-btn" onclick="location.reload()">Play Again</button>
        </div>
    </div>
    
    <script type="module">
        import * as THREE from 'three';
        import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
        import * as CANNON from 'cannon-es';

        // ==========================================
        // GAME CONFIGURATION
        // ==========================================
        const CONFIG = {
            // Physics - Adjusted for 1/3 earth circumference
            earthRadius: 4,
            playerRadius: 0.12,
            gravity: 120,
            mass: 5,
            damping: 0.55,          // Increased damping
            shootForce: 120,        // Reduced force
            coriolisFactor: 0.3,    // Reduced coriolis for cleaner shots
            
            // Game Rules
            gameDuration: 180,      // 3 minutes
            turnTimeLimit: 30,      // 30 seconds per turn
            
            // Visual
            trailSpacing: 0.25,
            trailSpeedThreshold: 0.3
        };

        // ==========================================
        // GAME STATE
        // ==========================================
        const gameState = {
            currentPlayer: 1,
            turn: 1,
            timeRemaining: CONFIG.gameDuration,
            isPlanning: true,
            hasShot: false,
            
            player1: {
                territory: 0,
                shots: 0,
                distance: 0,
                trails: []
            },
            
            player2: {
                territory: 0,
                shots: 0,
                distance: 0,
                trails: []
            },
            
            collisions: 0,
            
            settings: {
                soundEnabled: true,
                volume: 0.7,
                cameraRotation: true,
                showTrails: true
            }
        };

        // ==========================================
        // SCENE SETUP
        // ==========================================
        const scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(0xffffff, 0.015);

        const camera = new THREE.PerspectiveCamera(
            50,  // Wider FOV
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        // Closer camera for better view
        camera.position.set(0, 6, 12);

        const renderer = new THREE.WebGLRenderer({ 
            antialias: true, 
            alpha: true 
        });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        document.body.appendChild(renderer.domElement);

        // ==========================================
        // LIGHTING
        // ==========================================
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
        scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
        directionalLight.position.set(5, 10, 7);
        scene.add(directionalLight);

        // ==========================================
        // PHYSICS WORLD
        // ==========================================
        const world = new CANNON.World();
        world.gravity.set(0, 0, 0);
        world.broadphase = new CANNON.NaiveBroadphase();
        world.solver.iterations = 20;

        const physicsMaterial = new CANNON.Material('physics');
        const contactMaterial = new CANNON.ContactMaterial(
            physicsMaterial,
            physicsMaterial,
            { friction: 0.3, restitution: 0.2 }
        );
        world.addContactMaterial(contactMaterial);

        // ==========================================
        // EARTH
        // ==========================================
        const earthBody = new CANNON.Body({
            mass: 0,
            shape: new CANNON.Sphere(CONFIG.earthRadius),
            material: physicsMaterial
        });
        world.addBody(earthBody);

        const textureLoader = new THREE.TextureLoader();
        const earthTexture = textureLoader.load(
            'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_atmos_2048.jpg'
        );

        const earthMaterial = new THREE.ShaderMaterial({
            uniforms: {
                map: { value: earthTexture }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D map;
                varying vec2 vUv;
                
                void main() {
                    vec4 texColor = texture2D(map, vUv);
                    vec3 color = vec3(0.4, 0.7, 1.0);
                    
                    float brightness = texColor.r + texColor.g + texColor.b;
                    
                    if (texColor.b <= texColor.r + 0.1) {
                        if (brightness > 2.1) {
                            color = vec3(0.94, 0.96, 0.97);
                        } else if (texColor.r > texColor.g) {
                            color = vec3(1.0, 0.85, 0.56);
                        } else {
                            color = vec3(0.45, 0.82, 0.49);
                        }
                    }
                    
                    gl_FragColor = vec4(color, 1.0);
                }
            `
        });

        const earthMesh = new THREE.Mesh(
            new THREE.SphereGeometry(CONFIG.earthRadius, 64, 64),
            earthMaterial
        );
        scene.add(earthMesh);

        const outlineMesh = new THREE.Mesh(
            new THREE.SphereGeometry(CONFIG.earthRadius + 0.08, 64, 64),
            new THREE.MeshBasicMaterial({
                color: 0x2D3436,
                side: THREE.BackSide
            })
        );
        earthMesh.add(outlineMesh);

        // ==========================================
        // PLAYERS
        // ==========================================
        const players = [];
        
        function createPlayer(colorHex, position) {
            const body = new CANNON.Body({
                mass: CONFIG.mass,
                shape: new CANNON.Sphere(CONFIG.playerRadius),
                material: physicsMaterial,
                linearDamping: CONFIG.damping,
                angularDamping: 0.5
            });
            body.position.copy(position);
            world.addBody(body);

            const mesh = new THREE.Mesh(
                new THREE.SphereGeometry(CONFIG.playerRadius, 32, 32),
                new THREE.MeshToonMaterial({ color: colorHex })
            );
            scene.add(mesh);

            const hitBox = new THREE.Mesh(
                new THREE.SphereGeometry(CONFIG.playerRadius * 2.5, 16, 16),
                new THREE.MeshBasicMaterial({ visible: false })
            );
            mesh.add(hitBox);

            return { body, mesh, hitBox, lastTrailPos: position.clone() };
        }

        players.push(createPlayer(
            0xFF4757,
            new CANNON.Vec3(0, CONFIG.earthRadius + CONFIG.playerRadius + 0.05, 0)
        ));

        players.push(createPlayer(
            0x5352ED,
            new CANNON.Vec3(0, -(CONFIG.earthRadius + CONFIG.playerRadius + 0.05), 0)
        ));

        // ==========================================
        // CLOUDS
        // ==========================================
        const cloudGroup = new THREE.Group();
        scene.add(cloudGroup);

        const cloudMaterial = new THREE.MeshBasicMaterial({
            color: 0xFFFFFF,
            transparent: true,
            opacity: 0.6
        });

        for (let i = 0; i < 25; i++) {
            const cloud = new THREE.Mesh(
                new THREE.IcosahedronGeometry(0.2 + Math.random() * 0.15, 0),
                cloudMaterial
            );
            
            const radius = CONFIG.earthRadius + 0.6 + Math.random() * 0.5;
            cloud.position.setFromSphericalCoords(
                radius,
                Math.random() * Math.PI,
                Math.random() * Math.PI * 2
            );
            
            cloud.lookAt(0, 0, 0);
            cloud.scale.set(
                1 + Math.random() * 0.3,
                0.5 + Math.random() * 0.2,
                0.7
            );
            
            cloudGroup.add(cloud);
        }

        // ==========================================
        // TRAIL SYSTEMS (Separate for each player)
        // ==========================================
        const TRAIL_MAX = 1000;
        
        function createTrailSystem(color) {
            const geometry = new THREE.SphereGeometry(0.035, 8, 8);
            const material = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: 0.7
            });
            
            const mesh = new THREE.InstancedMesh(geometry, material, TRAIL_MAX);
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            scene.add(mesh);
            
            return { mesh, count: 0, dummy: new THREE.Object3D() };
        }

        const trail1 = createTrailSystem(0xFF4757);
        const trail2 = createTrailSystem(0x5352ED);

        function addTrail(trailSystem, position) {
            if (trailSystem.count >= TRAIL_MAX) return;
            
            trailSystem.dummy.position.copy(position);
            trailSystem.dummy.position.setLength(CONFIG.earthRadius + 0.02);
            trailSystem.dummy.updateMatrix();
            trailSystem.mesh.setMatrixAt(trailSystem.count++, trailSystem.dummy.matrix);
            trailSystem.mesh.instanceMatrix.needsUpdate = true;
        }

        // ==========================================
        // AIMING SYSTEM (Simplified)
        // ==========================================
        const aimGroup = new THREE.Group();
        aimGroup.visible = false;
        scene.add(aimGroup);

        // Simple arrow (no tail)
        const arrow = new THREE.ArrowHelper(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(0, 0, 0),
            1.5,
            0x72D27E,
            0.3,
            0.2
        );
        aimGroup.add(arrow);

        // Short trajectory (only initial path)
        const TRAJ_POINTS = 30;  // Reduced from 100
        const trajectoryGeometry = new THREE.BufferGeometry();
        const trajectoryPositions = new Float32Array(TRAJ_POINTS * 3);
        trajectoryGeometry.setAttribute(
            'position',
            new THREE.BufferAttribute(trajectoryPositions, 3)
        );

        const trajectoryMaterial = new THREE.LineDashedMaterial({
            color: 0xFFFFFF,
            dashSize: 0.15,
            gapSize: 0.1,
            transparent: true,
            opacity: 0.4  // More subtle
        });

        const trajectoryLine = new THREE.Line(
            trajectoryGeometry,
            trajectoryMaterial
        );
        trajectoryLine.visible = false;
        scene.add(trajectoryLine);

        // ==========================================
        // TERRITORY VISUALIZATION
        // ==========================================
        const territories = new Map();

        function calculateTerritory(playerIndex) {
            const trailSystem = playerIndex === 0 ? trail1 : trail2;
            // Simple circle-based territory calculation
            return Math.min((trailSystem.count / TRAIL_MAX) * 100, 100);
        }

        // ==========================================
        // UI ELEMENTS
        // ==========================================
        const elements = {
            timer: document.getElementById('timer'),
            territoryP1: document.getElementById('territory-p1'),
            territoryP2: document.getElementById('territory-p2'),
            avatarP1: document.getElementById('avatar-p1'),
            avatarP2: document.getElementById('avatar-p2'),
            turnIndicator: document.getElementById('turn-indicator'),
            turnText: document.getElementById('turn-text'),
            powerGauge: document.getElementById('power-gauge'),
            powerFill: document.getElementById('power-fill'),
            statsPanel: document.getElementById('stats-panel'),
            optionsPanel: document.getElementById('options-panel'),
            gameOver: document.getElementById('game-over'),
            
            // Stats
            statTurn: document.getElementById('stat-turn'),
            statP1Shots: document.getElementById('stat-p1-shots'),
            statP2Shots: document.getElementById('stat-p2-shots'),
            statP1Distance: document.getElementById('stat-p1-distance'),
            statP2Distance: document.getElementById('stat-p2-distance'),
            statCollisions: document.getElementById('stat-collisions')
        };

        // ==========================================
        // GAME LOGIC
        // ==========================================
        function switchTurn() {
            gameState.currentPlayer = gameState.currentPlayer === 1 ? 2 : 1;
            gameState.turn++;
            gameState.isPlanning = true;
            gameState.hasShot = false;
            
            // Update UI
            elements.avatarP1.classList.toggle('active', gameState.currentPlayer === 1);
            elements.avatarP2.classList.toggle('active', gameState.currentPlayer === 2);
            
            // Show turn indicator
            elements.turnText.textContent = `Player ${gameState.currentPlayer}'s Turn`;
            elements.turnIndicator.classList.add('show');
            setTimeout(() => {
                elements.turnIndicator.classList.remove('show');
            }, 1500);
            
            updateStats();
        }

        function updateStats() {
            elements.statTurn.textContent = gameState.turn;
            elements.statP1Shots.textContent = gameState.player1.shots;
            elements.statP2Shots.textContent = gameState.player2.shots;
            elements.statP1Distance.textContent = `${(gameState.player1.distance * 0.1).toFixed(1)} km`;
            elements.statP2Distance.textContent = `${(gameState.player2.distance * 0.1).toFixed(1)} km`;
            elements.statCollisions.textContent = gameState.collisions;
        }

        function updateTimer() {
            if (gameState.timeRemaining <= 0) {
                endGame();
                return;
            }
            
            gameState.timeRemaining--;
            const minutes = Math.floor(gameState.timeRemaining / 60);
            const seconds = gameState.timeRemaining % 60;
            elements.timer.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            
            // Update territories
            gameState.player1.territory = calculateTerritory(0);
            gameState.player2.territory = calculateTerritory(1);
            elements.territoryP1.textContent = `${gameState.player1.territory.toFixed(1)}%`;
            elements.territoryP2.textContent = `${gameState.player2.territory.toFixed(1)}%`;
        }

        function endGame() {
            const winner = gameState.player1.territory > gameState.player2.territory ? 1 : 2;
            
            document.getElementById('winner-text').textContent = `Player ${winner} Wins!`;
            document.getElementById('final-p1').textContent = `${gameState.player1.territory.toFixed(1)}%`;
            document.getElementById('final-p2').textContent = `${gameState.player2.territory.toFixed(1)}%`;
            
            elements.gameOver.classList.add('show');
        }

        // ==========================================
        // MOUSE INTERACTION
        // ==========================================
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        let isDragging = false;
        const dragStart = new THREE.Vector2();

        function getIntersects(event, objects) {
            mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
            raycaster.setFromCamera(mouse, camera);
            return raycaster.intersectObjects(objects, true);
        }

        function calculateForce(currentX, currentY, startX, startY) {
            const deltaX = currentX - startX;
            const deltaY = currentY - startY;
            
            const player = players[gameState.currentPlayer - 1];
            const up = player.mesh.position.clone().normalize();
            const camDir = new THREE.Vector3();
            camera.getWorldDirection(camDir);
            
            const right = new THREE.Vector3()
                .crossVectors(camDir, up)
                .normalize();
            const forward = new THREE.Vector3()
                .crossVectors(up, right)
                .normalize();
            
            const forceDir = new THREE.Vector3()
                .addScaledVector(right, -deltaX)
                .addScaledVector(forward, deltaY)
                .normalize();
            
            return { forceDir, deltaX, deltaY };
        }

        function updateTrajectory(startPos, impulseVector) {
            const simPos = startPos.clone();
            const simVel = impulseVector
                .clone()
                .multiplyScalar(1 / CONFIG.mass * 0.016);
            
            const positions = trajectoryLine.geometry.attributes.position.array;
            
            for (let i = 0; i < TRAJ_POINTS; i++) {
                positions[i * 3] = simPos.x;
                positions[i * 3 + 1] = simPos.y;
                positions[i * 3 + 2] = simPos.z;
                
                const gravityDir = simPos.clone().normalize().negate();
                simVel.add(gravityDir.multiplyScalar(0.04));
                simVel.multiplyScalar(0.98);
                simPos.add(simVel);
                
                if (simPos.length() < CONFIG.earthRadius + CONFIG.playerRadius) {
                    simPos.setLength(CONFIG.earthRadius + CONFIG.playerRadius + 0.02);
                }
            }
            
            trajectoryLine.geometry.attributes.position.needsUpdate = true;
            trajectoryLine.computeLineDistances();
        }

        window.addEventListener('mousedown', (e) => {
            if (!gameState.isPlanning || gameState.hasShot) return;
            
            const player = players[gameState.currentPlayer - 1];
            const hits = getIntersects(e, [player.mesh]);
            
            if (hits.length > 0) {
                isDragging = true;
                controls.enabled = false;
                dragStart.set(e.clientX, e.clientY);
                
                aimGroup.visible = true;
                trajectoryLine.visible = true;
                aimGroup.position.copy(player.mesh.position);
                
                elements.powerGauge.classList.add('visible');
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) {
                const player = players[gameState.currentPlayer - 1];
                const hits = getIntersects(e, [player.mesh]);
                document.body.style.cursor = hits.length > 0 ? 'grab' : 'default';
                return;
            }
            
            document.body.style.cursor = 'grabbing';
            
            const { forceDir, deltaX, deltaY } = calculateForce(
                e.clientX, e.clientY,
                dragStart.x, dragStart.y
            );
            
            const dist = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            const MAX_DRAG = 250;
            const powerRatio = Math.min(dist, MAX_DRAG) / MAX_DRAG;
            
            arrow.setDirection(forceDir);
            const arrowLength = 1 + powerRatio * 2;
            arrow.setLength(arrowLength, 0.3, 0.2);
            arrow.setColor(
                new THREE.Color().setHSL(0.3 * (1 - powerRatio), 1, 0.5)
            );
            
            const impulseStrength = powerRatio * CONFIG.shootForce;
            const impulseVector = forceDir.clone().multiplyScalar(impulseStrength);
            const player = players[gameState.currentPlayer - 1];
            updateTrajectory(player.mesh.position, impulseVector);
            
            elements.powerFill.style.width = `${powerRatio * 100}%`;
        });

        window.addEventListener('mouseup', (e) => {
            if (!isDragging) return;
            
            isDragging = false;
            controls.enabled = true;
            
            aimGroup.visible = false;
            trajectoryLine.visible = false;
            elements.powerGauge.classList.remove('visible');
            elements.powerFill.style.width = '0%';
            document.body.style.cursor = 'default';
            
            const { forceDir, deltaX, deltaY } = calculateForce(
                e.clientX, e.clientY,
                dragStart.x, dragStart.y
            );
            
            const dist = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            const MAX_DRAG = 250;
            const powerRatio = Math.min(dist, MAX_DRAG) / MAX_DRAG;
            
            const impulseStrength = powerRatio * CONFIG.shootForce;
            const impulse = forceDir.multiplyScalar(impulseStrength);
            
            const player = players[gameState.currentPlayer - 1];
            player.body.applyImpulse(impulse, player.body.position);
            
            gameState.hasShot = true;
            gameState.isPlanning = false;
            
            if (gameState.currentPlayer === 1) {
                gameState.player1.shots++;
            } else {
                gameState.player2.shots++;
            }
            
            updateStats();
        });

        // ==========================================
        // UI CONTROLS
        // ==========================================
        document.getElementById('btn-stats').addEventListener('click', () => {
            elements.statsPanel.style.display = 
                elements.statsPanel.style.display === 'none' ? 'block' : 'none';
        });

        document.getElementById('btn-options').addEventListener('click', () => {
            elements.optionsPanel.style.display = 
                elements.optionsPanel.style.display === 'none' ? 'block' : 'none';
        });

        document.getElementById('btn-shoot').addEventListener('click', () => {
            if (!gameState.hasShot) return;
            
            // Wait for ball to stop
            const player = players[gameState.currentPlayer - 1];
            if (player.body.velocity.length() < 0.5) {
                switchTurn();
            }
        });

        document.getElementById('btn-reset').addEventListener('click', () => {
            location.reload();
        });

        document.getElementById('btn-help').addEventListener('click', () => {
            alert('🌍 Globe Striker\n\n' +
                  '1. Click and drag your ball backward to aim\n' +
                  '2. Release to shoot\n' +
                  '3. Leave trails to claim territory\n' +
                  '4. Most territory wins!\n\n' +
                  'Good luck! 🎯');
        });

        // Toggle switches
        document.getElementById('toggle-sound').addEventListener('click', function() {
            this.classList.toggle('active');
            gameState.settings.soundEnabled = this.classList.contains('active');
        });

        document.getElementById('toggle-rotation').addEventListener('click', function() {
            this.classList.toggle('active');
            gameState.settings.cameraRotation = this.classList.contains('active');
        });

        document.getElementById('toggle-trails').addEventListener('click', function() {
            this.classList.toggle('active');
            gameState.settings.showTrails = this.classList.contains('active');
            trail1.mesh.visible = this.classList.contains('active');
            trail2.mesh.visible = this.classList.contains('active');
        });

        // Volume slider
        let volumeDragging = false;
        const volumeSlider = document.getElementById('volume-slider');
        const volumeFill = document.getElementById('volume-fill');

        volumeSlider.addEventListener('mousedown', (e) => {
            volumeDragging = true;
            updateVolume(e);
        });

        document.addEventListener('mousemove', (e) => {
            if (volumeDragging) updateVolume(e);
        });

        document.addEventListener('mouseup', () => {
            volumeDragging = false;
        });

        function updateVolume(e) {
            const rect = volumeSlider.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const percent = Math.max(0, Math.min(1, x / rect.width));
            volumeFill.style.width = `${percent * 100}%`;
            gameState.settings.volume = percent;
        }

        // ==========================================
        // PHYSICS & FORCES
        // ==========================================
        function applyPhysicsForces(body) {
            const gravityDir = body.position.clone().negate().unit();
            body.applyForce(
                gravityDir.scale(CONFIG.gravity * body.mass),
                body.position
            );
            
            if (body.velocity.lengthSquared() > 0.1) {
                const vel = new THREE.Vector3(
                    body.velocity.x,
                    body.velocity.y,
                    body.velocity.z
                );
                const omega = new THREE.Vector3(0, 1, 0);
                const coriolis = new THREE.Vector3()
                    .crossVectors(vel, omega)
                    .multiplyScalar(CONFIG.coriolisFactor);
                body.applyForce(coriolis, body.position);
            }
        }

        // Collision detection
        world.addEventListener('postStep', () => {
            // Simple collision check between players
            const p1Pos = new THREE.Vector3().copy(players[0].body.position);
            const p2Pos = new THREE.Vector3().copy(players[1].body.position);
            const dist = p1Pos.distanceTo(p2Pos);
            
            if (dist < CONFIG.playerRadius * 2.5) {
                gameState.collisions++;
                updateStats();
            }
        });

        // ==========================================
        // CAMERA CONTROLS
        // ==========================================
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enablePan = false;
        controls.minDistance = 6;   // Closer minimum
        controls.maxDistance = 18;  // Closer maximum
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;

        // ==========================================
        // ANIMATION LOOP
        // ==========================================
        const clock = new THREE.Clock();
        let lastSecond = 0;

        function animate() {
            requestAnimationFrame(animate);
            
            const deltaTime = Math.min(clock.getDelta(), 0.1);
            const elapsedTime = clock.getElapsedTime();
            
            // Timer update (every second)
            if (Math.floor(elapsedTime) > lastSecond) {
                lastSecond = Math.floor(elapsedTime);
                updateTimer();
            }
            
            // Physics
            players.forEach(player => applyPhysicsForces(player.body));
            world.step(deltaTime);
            
            // Sync visuals
            players.forEach((player, idx) => {
                player.mesh.position.copy(player.body.position);
                player.mesh.quaternion.copy(player.body.quaternion);
                
                // Trail generation
                const speed = player.body.velocity.length();
                if (speed > CONFIG.trailSpeedThreshold && gameState.settings.showTrails) {
                    const currentPos = new THREE.Vector3().copy(player.body.position);
                    const dist = currentPos.distanceTo(player.lastTrailPos);
                    
                    if (dist > CONFIG.trailSpacing) {
                        const trailSystem = idx === 0 ? trail1 : trail2;
                        addTrail(trailSystem, currentPos);
                        player.lastTrailPos.copy(currentPos);
                        
                        if (idx === 0) {
                            gameState.player1.distance += dist;
                        } else {
                            gameState.player2.distance += dist;
                        }
                    }
                }
                
                // Auto-advance turn if ball stopped
                if (gameState.hasShot && !gameState.isPlanning) {
                    if (idx === gameState.currentPlayer - 1 && speed < 0.3) {
                        setTimeout(() => switchTurn(), 500);
                        gameState.isPlanning = true; // Prevent multiple triggers
                    }
                }
            });
            
            // Cloud rotation
            if (gameState.settings.cameraRotation) {
                cloudGroup.rotation.y += 0.0001;
            }
            
            // Dynamic aim tracking
            if (isDragging) {
                const player = players[gameState.currentPlayer - 1];
                aimGroup.position.copy(player.mesh.position);
            }
            
            controls.update();
            renderer.render(scene, camera);
        }

        // ==========================================
        // WINDOW RESIZE
        // ==========================================
        window.addEventListener('resize', () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        });

        // ==========================================
        // START GAME
        // ==========================================
        const loading = document.getElementById('loading');
        
        setTimeout(() => {
            loading.classList.add('hidden');
            animate();
            
            // Show first turn
            elements.turnIndicator.classList.add('show');
            setTimeout(() => {
                elements.turnIndicator.classList.remove('show');
            }, 2000);
        }, 1500);
    </script>
</body>
</html>
