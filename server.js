const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// WICHTIG: Erlaubt dem Browser den Zugriff auf index.html und den js/ Ordner
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

const players = {};

io.on('connection', (socket) => {
    console.log('Spieler verbunden:', socket.id);

    // Neuen Spieler mit Standardposition registrieren
    players[socket.id] = { x: 0, y: 0, z: 0 };

    // Bisherige Spieler an den neuen Spieler senden
    socket.emit('currentPlayers', players);

    // Alle anderen über den neuen Spieler informieren
    socket.broadcast.emit('newPlayer', {
        id: socket.id,
        position: players[socket.id]
    });

    // Bewegungssignale weiterleiten
    socket.on('playerMove', (movementData) => {
        if (players[socket.id]) {
            players[socket.id] = movementData;
            socket.broadcast.emit('playerMoved', {
                id: socket.id,
                position: movementData
            });
        }
    });

    // Disconnect verarbeiten
    socket.on('disconnect', () => {
        console.log('Spieler getrennt:', socket.id);
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server läuft auf Port ${PORT}`);
});
