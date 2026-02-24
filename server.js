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

function startNextNightPhase(room){

  const r = rooms[room];
  r.nightStep++;


if(r.nightStep >= NIGHT_ORDER.length){

    r.phase = "day";

    // 🔥 هنا كنخزنو الأدوار النهائية الحقيقية

    io.to(room).emit("dayPhase");
    return;
}
  const role = NIGHT_ORDER[r.nightStep];
  r.currentRole = role;

  const rolePlayers = r.players.filter(p=>p.originalRole===role);
  r.waitingPlayers = rolePlayers.map(p=>p.id);
  r.completedPlayers = [];

  io.to(room).emit("nightRole", role);
    // ✅ إلا ماكاين حتى لاعب عندو هاد الدور → يدوز مباشرة
  if(rolePlayers.length === 0){
    setTimeout(()=>completeRole(room), 5000);
    return;
  }

  // ===== WEREWOLF =====
  if(role === "Werewolf"){

    const wolves = rolePlayers;

    if(wolves.length > 1){
      wolves.forEach(w=>{
        const others = wolves
          .filter(x=>x.id!==w.id)
          .map(x=>x.name);

        io.to(w.id).emit("wolvesInfo", others);
      });

      // مباشرة يكمل الدور
      setTimeout(()=>completeRole(room),7000);
    }

    if(wolves.length === 1){
      r.waitingPlayers = [wolves[0].id];
      io.to(wolves[0].id).emit("loneWolfTurn");
    }

    return;
  }

  // ===== MINION =====
  if(role === "Minion"){
    const wolves = r.players
      .filter(p=>p.originalRole==="Werewolf")
      .map(p=>p.name);

    rolePlayers.forEach(p=>{
      io.to(p.id).emit("minionInfo", wolves);
    });

// نخليو frontend هو لي يسالي الدور
    return;
  }

  // ===== INSOMNIAC =====
if(role === "Insomniac"){

  const rolePlayers = r.players.filter(p=>p.originalRole==="Insomniac");

  rolePlayers.forEach(p=>{
    io.to(p.id).emit("reveal",[p.role]); // 🔥 هنا تشوف الدور النهائي
  });

  setTimeout(()=>completeRole(room),7000);
  return;
}
}

function completeRole(room){
  const r = rooms[room];
  r.currentRole = null;
  r.waitingPlayers = [];
  r.completedPlayers = [];
  startNextNightPhase(room);
}

io.on("connection", socket=>{

  socket.on("requestPlayersUpdate",(room)=>{
  const r = rooms[room];
  if(!r) return;

  io.to(room).emit("updatePlayers",{
    players: r.players,
    host: r.host
  });
  });
  socket.on("joinRoom",({room,name,isHost})=>{

    if(!room || !name) return;

    socket.join(room);

    if(!rooms[room]){
      rooms[room]={
        players:[],
        center:[],
        votes:{},
        host:null,
        phase:"lobby",
        scoreboard:{villagers:0,wolves:0,tanner:0},
        nightStep:-1,
        currentRole:null,
        waitingPlayers:[],
        completedPlayers:[],
        finalSnapshot:null // 🔥 جديد
      };
    }

    const r=rooms[room];

    r.players=r.players.filter(p=>p.name!==name);
    r.players.push({id:socket.id,name,role:null});

    if(isHost) r.host=socket.id;
    if(!r.host) r.host=r.players[0].id;

    io.to(room).emit("updatePlayers",{players:r.players,host:r.host});
    io.to(room).emit("scoreboard",r.scoreboard);
  });

socket.on("startGameWithRoles",({room,selectedRoles})=>{

  const r=rooms[room];
  if(!r || socket.id!==r.host) return;

  if(r.players.length<3){
    io.to(socket.id).emit("errorMessage","Minimum 3 players required");
    return;
  }

  const playerCount = r.players.length;

  // ===== SMART WOLF COUNT =====
  const hasMinion = selectedRoles.includes("Minion");
  const hasTanner = selectedRoles.includes("Tanner");

  let wolfCount = 1;

  if(playerCount <= 4){
    wolfCount = 1;
  }
  else if(playerCount === 5){
    wolfCount = hasMinion ? 1 : (Math.random()<0.5?1:2);
  }
  else if(playerCount === 6){
    wolfCount = hasMinion ? 2 : (Math.random()<0.6?2:1);
  }
  else{
    wolfCount = 2;
  }

  // ===== BUILD ROLES =====
  let roles = [];

  for(let i=0;i<wolfCount;i++){
    roles.push("Werewolf");
  }

  roles.push(...selectedRoles);

while(roles.length < playerCount + 3){
  roles.push("Villager");
}


console.log("Total roles:", roles);
console.log("Wolf count inside roles:", roles.filter(r=>r==="Werewolf").length);


  shuffle(roles);

  // 🔥 ضمان وجود ذئب واحد على الأقل عند اللاعبين
  let playerRoles = roles.slice(0, playerCount);
  let centerRoles = roles.slice(playerCount, playerCount + 3);

// 🔥 ضمان عدد الذئاب الصحيح عند اللاعبين
let wolvesInPlayers = playerRoles.filter(r=>r==="Werewolf").length;

if(wolvesInPlayers < wolfCount){

  let wolvesNeeded = wolfCount - wolvesInPlayers;

  for(let i=0;i<centerRoles.length && wolvesNeeded>0;i++){

    if(centerRoles[i] === "Werewolf"){

      // نقلب شي لاعب ماشي ذئب
      for(let j=0;j<playerRoles.length;j++){

        if(playerRoles[j] !== "Werewolf"){

          playerRoles[j] = "Werewolf";
          centerRoles[i] = "Villager";

          wolvesNeeded--;
          break;
        }
      }
    }
  }
}

  // توزيع
  r.players.forEach((p,i)=>{
    p.role = playerRoles[i];
     p.originalRole = playerRoles[i]; // 🔥 مهم بزاف
    io.to(p.id).emit("yourRole",p.role);
  });

 r.center = centerRoles.slice(0,3);

  r.votes={};
  r.phase="night";
  r.nightStep=-1;

  startNextNightPhase(room);
});

  socket.on("roleDone",(room)=>{
    const r=rooms[room];
    if(!r.currentRole) return;

    console.log("CURRENT ROLE:", r.currentRole);
console.log("WAITING:", r.waitingPlayers);
console.log("DONE:", r.completedPlayers);

    if(!r.completedPlayers.includes(socket.id)){
      r.completedPlayers.push(socket.id);
    }

    if(r.completedPlayers.length === r.waitingPlayers.length){
      completeRole(room);
    }
  });

  // ===== SEER =====
// ===== SEER =====
socket.on("seerAction",({room,targetId,centerIndexes})=>{

  const r = rooms[room];
  if(!r || r.currentRole!=="Seer") return;

  // 👁‍🗨 اختيار لاعب
  if(targetId){
    const target = r.players.find(p=>p.id===targetId);
    if(target){
      io.to(socket.id).emit("reveal",[target.role]);
    }
  }

  // 👁‍🗨 اختيار بطاقتين من الوسط
  if(centerIndexes && centerIndexes.length===2){

    const rolesSeen = centerIndexes.map(i=>r.center[i]);
    io.to(socket.id).emit("reveal",rolesSeen);
  }
});

  // ===== ROBBER =====
  socket.on("robberAction",({room,targetId})=>{
    const r=rooms[room];
    if(r.currentRole!=="Robber") return;

    const robber=r.players.find(p=>p.id===socket.id);
    const target=r.players.find(p=>p.id===targetId);

    if(robber && target){
      [robber.role,target.role]=[target.role,robber.role];
      io.to(socket.id).emit("reveal",[robber.role]);
    }
  });

  // ===== TROUBLEMAKER =====
  socket.on("troubleAction",({room,id1,id2})=>{
    const r=rooms[room];
    if(r.currentRole!=="Troublemaker") return;

    const p1=r.players.find(p=>p.id===id1);
    const p2=r.players.find(p=>p.id===id2);

    if(p1 && p2){
      [p1.role,p2.role]=[p2.role,p1.role];
    }
  });

  // ===== DRUNK =====
  socket.on("drunkAction",({room,index})=>{
    const r=rooms[room];
    if(r.currentRole!=="Drunk") return;

    const drunk=r.players.find(p=>p.id===socket.id);

    if(index>=0 && index<r.center.length){
      [drunk.role,r.center[index]]=[r.center[index],drunk.role];
    }
  });

// ===== LONE WOLF =====
socket.on("loneWolfPickCenter",({room,index})=>{

  const r = rooms[room];
  if(!r || r.currentRole!=="Werewolf") return;

  const wolves = r.players.filter(p=>p.originalRole==="Werewolf");

  if(wolves.length===1 && wolves[0].id===socket.id){

    if(index >=0 && index < 3){

      const seenRole = r.center[index];

      io.to(socket.id).emit("reveal",[seenRole]);


    }
  }
});
// ===== RESTART GAME =====
socket.on("restartGame",(room)=>{

  const r = rooms[room];
  if(!r || socket.id !== r.host) return;

  // رجوع للوبي
  r.phase = "lobby";
  r.votes = {};
  r.nightStep = -1;
  r.currentRole = null;
  r.waitingPlayers = [];
  r.completedPlayers = [];
  r.finalSnapshot = null;


  // 🔥 مهم: نرسل reset قبل ما نمسحو الأدوار
  io.to(room).emit("resetGame");

  // دابا نمسحو الأدوار
  r.players.forEach(p=>{
    p.role = null;
    p.originalRole = null;
  });

  r.center = [];

  // تحديث اللاعبين
  io.to(room).emit("updatePlayers",{
    players: r.players,
    host: r.host
  });

});
  // ===== VOTING =====
socket.on("vote",({room,target})=>{

  const r=rooms[room];
  if(!r) return;

  // منع إعادة التصويت
  if(r.votes[socket.id]) return;

  r.votes[socket.id]=target;

  // حساب مؤقت للأصوات
  let count={};

  Object.values(r.votes).forEach(id=>{
    count[id]=(count[id]||0)+1;
  });

  // نرسل التحديث لكل اللاعبين
  io.to(room).emit("voteUpdate",count);

  // إلا صوّتوا كاملين
  if(Object.keys(r.votes).length===r.players.length){
    finishGame(room);
  }
});

function finishGame(room){

  const r = rooms[room];
  if(!r) return;

  let count = {};

  Object.values(r.votes).forEach(id=>{
    count[id] = (count[id]||0)+1;
  });

  const maxVotes = Math.max(...Object.values(count));
  const eliminatedIds = Object.keys(count)
    .filter(id => count[id] === maxVotes);

  const eliminatedPlayers = r.players
    .filter(p=>eliminatedIds.includes(p.id));

  const wolves = r.players.filter(p=>p.role==="Werewolf");
  const tanner = r.players.find(p=>p.role==="Tanner");

  let winner = "Villagers Win 🏡";

  if(tanner && eliminatedPlayers.some(p=>p.role==="Tanner")){
    winner = "Tanner Wins 😈";
    r.scoreboard.tanner++;
  }
  else if(eliminatedPlayers.some(p=>p.role==="Werewolf")){
    winner = "Villagers Win 🏡";
    r.scoreboard.villagers++;
  }
  else{
    if(wolves.length > 0){
      winner = "Werewolves Win 🐺";
      r.scoreboard.wolves++;
    } else {
      winner = "Villagers Win 🏡";
      r.scoreboard.villagers++;
    }
  }

  // 🔥 هنا كنرسلو الأدوار الحقيقية مباشرة
  const finalPlayers = r.players.map(p=>({
    name: p.name,
    role: p.role
  }));

  const finalCenter = [...r.center];

console.log("FINAL PLAYERS:", finalPlayers);
console.log("FINAL CENTER:", finalCenter);



  io.to(room).emit("finalReveal",{
    eliminated: eliminatedPlayers.map(p=>p.name).join(", "),
    role: eliminatedPlayers.map(p=>p.role).join(", "),
    winner,
    players: finalPlayers,
    center: finalCenter
  });

  io.to(room).emit("scoreboard", r.scoreboard);

  r.phase = "ended";
}
});

server.listen(process.env.PORT||3000,
()=>console.log("🔥 PRO Night Engine Running"));