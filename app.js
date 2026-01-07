// Placeholder app.js
fetch("data.json").then(r=>r.json()).then(()=>{
  document.getElementById("content").innerText="data.json caricato";
});
