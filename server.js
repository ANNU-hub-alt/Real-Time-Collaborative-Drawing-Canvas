const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let operations = [];
let undone = [];

app.get("/", (_, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Collaborative Canvas</title>
  <style>
    body { margin:0; overflow:hidden; font-family: sans-serif; }
    canvas { position:absolute; top:0; left:0; }
    #toolbar {
      position:fixed; top:10px; left:10px;
      background:#fff; padding:8px; border-radius:6px;
      box-shadow:0 2px 6px rgba(0,0,0,0.2);
    }
  </style>
</head>
<body>
  <div id="toolbar">
    <input type="color" id="color" value="#000000"/>
    <input type="range" id="width" min="1" max="10" value="3"/>
    <button onclick="undo()">Undo</button>
    <button onclick="redo()">Redo</button>
  </div>

  <canvas id="canvas"></canvas>
  <canvas id="cursorLayer"></canvas>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    const canvas = document.getElementById("canvas");
    const cursorLayer = document.getElementById("cursorLayer");
    const ctx = canvas.getContext("2d");
    const cursorCtx = cursorLayer.getContext("2d");

    canvas.width = cursorLayer.width = window.innerWidth;
    canvas.height = cursorLayer.height = window.innerHeight;

    let drawing = false;
    let strokeId = null;
    let localOps = [];
    let cursors = {};

    function drawOp(op) {
      ctx.strokeStyle = op.color;
      ctx.lineWidth = op.width;
      ctx.lineCap = "round";
      ctx.beginPath();
      op.points.forEach((p,i)=>{
        if(i===0) ctx.moveTo(p.x,p.y);
        else ctx.lineTo(p.x,p.y);
      });
      ctx.stroke();
    }

    function redraw() {
      ctx.clearRect(0,0,canvas.width,canvas.height);
      localOps.forEach(drawOp);
    }

    canvas.onmousedown = e => {
      drawing = true;
      strokeId = crypto.randomUUID();
      const op = {
        id: strokeId,
        color: color.value,
        width: width.value,
        points: [{ x: e.clientX, y: e.clientY }]
      };
      localOps.push(op);
      socket.emit("stroke:start", op);
    };

    canvas.onmousemove = e => {
      socket.emit("cursor", { x: e.clientX, y: e.clientY });
      if (!drawing) return;
      const op = localOps.at(-1);
      op.points.push({ x: e.clientX, y: e.clientY });
      drawOp({ ...op, points: op.points.slice(-2) });
      socket.emit("stroke:move", { id: strokeId, point: op.points.at(-1) });
    };

    window.onmouseup = () => {
      if (!drawing) return;
      drawing = false;
      socket.emit("stroke:end", strokeId);
    };

    socket.on("init", ops => {
      localOps = ops;
      redraw();
    });

    socket.on("stroke:start", op => {
      localOps.push(op);
    });

    socket.on("stroke:move", data => {
      const op = localOps.find(o => o.id === data.id);
      if (!op) return;
      op.points.push(data.point);
      drawOp({ ...op, points: op.points.slice(-2) });
    });

    socket.on("undo", () => {
      localOps.pop();
      redraw();
    });

    socket.on("redo", op => {
      localOps.push(op);
      redraw();
    });

    socket.on("cursor", data => {
      cursors[data.id] = data;
      cursorCtx.clearRect(0,0,cursorLayer.width,cursorLayer.height);
      Object.values(cursors).forEach(c=>{
        cursorCtx.beginPath();
        cursorCtx.arc(c.x,c.y,4,0,Math.PI*2);
        cursorCtx.fillStyle = c.color;
        cursorCtx.fill();
      });
    });

    function undo(){ socket.emit("undo"); }
    function redo(){ socket.emit("redo"); }
  </script>
</body>
</html>
`);
});

io.on("connection", socket => {
  socket.emit("init", operations);

  socket.on("stroke:start", op => {
    operations.push(op);
    undone = [];
    socket.broadcast.emit("stroke:start", op);
  });

  socket.on("stroke:move", data => {
    socket.broadcast.emit("stroke:move", data);
  });

  socket.on("undo", () => {
    if (!operations.length) return;
    const op = operations.pop();
    undone.push(op);
    io.emit("undo");
  });

  socket.on("redo", () => {
    if (!undone.length) return;
    const op = undone.pop();
    operations.push(op);
    io.emit("redo", op);
  });

  socket.on("cursor", pos => {
    socket.broadcast.emit("cursor", {
      ...pos,
      id: socket.id,
      color: "#"+socket.id.slice(-6)
    });
  });
});

server.listen(3000, () =>
  console.log("✅ Collaborative canvas running on http://localhost:3000")
);
