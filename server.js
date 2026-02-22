const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let rooms = {};

const NIGHT_ORDER = [
  "Doppelganger",
  "Werewolf",
  "Minion",
  "Seer",
  "Robber",
  "Troublemaker",
  "Drunk",
  "Insomniac"
];

function shuffle(array){
  for(let i=array.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [array[i],array[j]]=[array[j],array[i]];
  }
  return array;
}

io.on("connection", socket=>{

  socket.on("joinRoom", ({room,name})=>{
    socket.join(room);

    if(!rooms[room]){
      rooms[room]={
        players:[],
        center:[],
        votes:{},
        host:null,
        phase:"lobby",
        scoreboard:{villagers:0,wolves:0,tanner:0}
      };
    }

    rooms[room].players.push({id:socket.id,name,role:null});

    if(!rooms[room].host){
      rooms[room].host=socket.id;
    }

    io.to(room).emit("updatePlayers",{
      players:rooms[room].players,
      host:rooms[room].host
    });

    io.to(room).emit("scoreboard",rooms[room].scoreboard);
  });

  socket.on("startGameWithRoles",({room,selectedRoles})=>{
    const r=rooms[room];
    if(socket.id!==r.host) return;

    let roles=["Werewolf","Werewolf",...selectedRoles];

    while(roles.length<r.players.length+3){
      roles.push("Villager");
    }

    shuffle(roles);

    r.players.forEach((p,i)=>{
      p.role=roles[i];
      io.to(p.id).emit("yourRole",p.role);
    });

    r.center=roles.slice(r.players.length);
    r.votes={};
    r.phase="night";
    r.nightStep=0;

    runNight(room);
  });

  function runNight(room){
    const r=rooms[room];

    if(r.nightStep>=NIGHT_ORDER.length){
      r.phase="day";
      io.to(room).emit("dayPhase");
      return;
    }

    const role=NIGHT_ORDER[r.nightStep];
    io.to(room).emit("nightRole",role);

    if(role==="Werewolf"){
      const wolves=r.players.filter(p=>p.role==="Werewolf");
      wolves.forEach(w=>{
        const others=wolves.filter(x=>x.id!==w.id).map(x=>x.name);
        io.to(w.id).emit("wolvesInfo",others);
      });

      if(wolves.length===1){
        const randomIndex=Math.floor(Math.random()*3);
        io.to(wolves[0].id).emit("loneWolfCenter",r.center[randomIndex]);
      }
    }

    if(role==="Minion"){
      const wolves=r.players
        .filter(p=>p.role==="Werewolf")
        .map(p=>p.name);

      r.players.forEach(p=>{
        if(p.role==="Minion"){
          io.to(p.id).emit("minionInfo",wolves);
        }
      });
    }

    if(role==="Insomniac"){
      r.players.forEach(p=>{
        if(p.role==="Insomniac"){
          io.to(p.id).emit("reveal",[p.role]);
        }
      });
    }

    setTimeout(()=>{
      r.nightStep++;
      runNight(room);
    },15000);
  }

  socket.on("vote",({room,target})=>{
    const r=rooms[room];
    r.votes[socket.id]=target;

    if(Object.keys(r.votes).length===r.players.length){
      finishGame(room);
    }
  });

  function finishGame(room){
    const r=rooms[room];
    let count={};

    Object.values(r.votes).forEach(id=>{
      count[id]=(count[id]||0)+1;
    });

    const most=Object.keys(count)
      .reduce((a,b)=>count[a]>count[b]?a:b);

    const eliminated=r.players.find(p=>p.id===most);

    let winner="Werewolves Win 🐺";

    if(eliminated.role==="Tanner"){
      winner="Tanner Wins 😈";
      r.scoreboard.tanner++;
    }
    else if(eliminated.role==="Werewolf"){
      winner="Villagers Win 🏡";
      r.scoreboard.villagers++;
    }
    else{
      r.scoreboard.wolves++;
    }

    io.to(room).emit("gameResult",{
      eliminated:eliminated.name,
      role:eliminated.role,
      winner
    });

    io.to(room).emit("scoreboard",r.scoreboard);
  }

  socket.on("disconnect",()=>{
    for(const room in rooms){
      const r=rooms[room];
      r.players=r.players.filter(p=>p.id!==socket.id);

      if(r.host===socket.id){
        if(r.players.length>0){
          r.host=r.players[0].id;
        } else {
          delete rooms[room];
          return;
        }
      }

      io.to(room).emit("updatePlayers",{
        players:r.players,
        host:r.host
      });
    }
  });

});

server.listen(process.env.PORT||3000,
()=>console.log("🔥 Final Server Running"));