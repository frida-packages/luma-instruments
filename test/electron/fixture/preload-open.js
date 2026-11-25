const { ipcRenderer } = require("electron");

window.fixtureOpen = { role: "open", pid: process.pid };

ipcRenderer.on("tick", async (_event, n, flood) => {
    const problems = [];
    for (let i = 0; i !== flood; i++) {
        ipcRenderer.send("flood", i);
    }
    ipcRenderer.send("log:note", `open round ${n}`);
    const state = ipcRenderer.sendSync("state:get-sync");
    if (typeof state?.counter !== "number") {
        problems.push(`sendSync gave ${JSON.stringify(state)}`);
    }
    const sum = await ipcRenderer.invoke("math:add", n, 2);
    if (sum !== n + 2) {
        problems.push(`math:add gave ${sum}`);
    }
    const me = await ipcRenderer.invoke("local:whoami");
    if (me?.role !== "open") {
        problems.push(`local:whoami gave ${JSON.stringify(me)}`);
    }
    ipcRenderer.send("round:report", { ok: problems.length === 0, problems });
});

ipcRenderer.on("log:ack", () => {});
ipcRenderer.on("port:gift", () => {});
