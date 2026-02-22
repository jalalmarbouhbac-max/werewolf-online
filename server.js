const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let rooms = {};

function shuffle(array) {
  return array.sort(() => Math.random() - 0.5);
}

io.on("connection", (socket) => {

  socket.on("joinRoom", ({ room, name }) => {

    socket.join(room);

    if (!rooms[room]) {
      rooms[room] = {
        players: [],
        centerCards: [],
        votes: {},
        phase: "lobby"
      };
    }

    rooms[room].players.push({
      id: socket.id,
      name,
      role: null
    });

    io.to(room).emit("updatePlayers", rooms[room].players);
  });

  socket.on("startGame", (room) => {

    let roomData = rooms[room];

    let roles = [
      "Werewolf",
      "Werewolf",
      "Seer",
      "Robber",
      "Troublemaker",
      "Tanner",
      "Hunter",
      "Drunk",
      "Doppelganger"
    ];

    while (roles.length < roomData.players.length + 3) {
      roles.push("Villager");
    }

    roles = shuffle(roles);

    roomData.players.forEach((player, i) => {
      player.role = roles[i];
      io.to(player.id).emit("yourRole", player.role);
    });

    roomData.centerCards = roles.slice(roomData.players.length);
    roomData.phase = "night";
    roomData.votes = {};

    io.to(room).emit("nightPhase");

    setTimeout(() => {
      roomData.phase = "day";
      io.to(room).emit("dayPhase");
    }, 25000);
  });

  socket.on("doppelgangerCopy", ({ room, targetId }) => {
    let roomData = rooms[room];
    let me = roomData.players.find(p => p.id === socket.id);
    let target = roomData.players.find(p => p.id === targetId);

    if (me && target) {
      me.role = target.role;
      io.to(socket.id).emit("yourRole", me.role);
    }
  });

  socket.on("drunkSwap", ({ room }) => {
    let roomData = rooms[room];
    let me = roomData.players.find(p => p.id === socket.id);

    let randomIndex = Math.floor(Math.random() * roomData.centerCards.length);
    let temp = roomData.centerCards[randomIndex];

    roomData.centerCards[randomIndex] = me.role;
    me.role = temp;
  });

  socket.on("vote", ({ room, targetId }) => {

    let roomData = rooms[room];
    roomData.votes[socket.id] = targetId;

    if (Object.keys(roomData.votes).length === roomData.players.length) {

      let count = {};
      Object.values(roomData.votes).forEach(id => {
        count[id] = (count[id] || 0) + 1;
      });

      let mostVoted = Object.keys(count).reduce((a, b) =>
        count[a] > count[b] ? a : b
      );

      let eliminated = roomData.players.find(p => p.id === mostVoted);

      let winner = "Werewolves Win 🐺";

      if (eliminated.role === "Tanner") {
        winner = "Tanner Wins 😈";
      }
      else if (eliminated.role === "Werewolf") {
        winner = "Villagers Win 🏡";
      }

      if (eliminated.role === "Hunter") {
        winner += "\nHunter shoots someone!";
      }

      io.to(room).emit("gameResult", {
        eliminated: eliminated.name,
        role: eliminated.role,
        winner
      });
    }
  });

});

server.listen(process.env.PORT || 3000, () =>
  console.log("🔥 Server running")
);