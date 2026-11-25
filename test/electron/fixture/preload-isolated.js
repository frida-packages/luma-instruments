const { contextBridge, ipcRenderer } = require("electron");

const roundsSeen = [];

globalThis.preloadMarker = "isolated preload";

contextBridge.exposeInMainWorld("fixture", { role: "isolated", rounds: () => roundsSeen.length });

ipcRenderer.on("tick", async (_event, n) => {
    roundsSeen.push(n);
    const problems = [];
    ipcRenderer.send("log:note", `isolated round ${n}`, { n });
    const state = ipcRenderer.sendSync("state:get-sync");
    if (typeof state?.counter !== "number") {
        problems.push(`sendSync gave ${JSON.stringify(state)}`);
    }
    const sum = await ipcRenderer.invoke("math:add", n, 1);
    if (sum !== n + 1) {
        problems.push(`math:add gave ${sum}`);
    }
    try {
        await ipcRenderer.invoke("math:fail", "please");
        problems.push("math:fail resolved");
    } catch (e) {
        if (!String(e.message).includes("refused on purpose")) {
            problems.push(`math:fail rejected with ${e.message}`);
        }
    }
    const slow = await ipcRenderer.invoke("data:slow", n);
    if (slow?.n !== n || slow.bytes?.length !== 4) {
        problems.push(`data:slow gave ${JSON.stringify(slow)}`);
    }
    const echo = await offerPort(n);
    if (echo?.echo?.round !== n) {
        problems.push(`port echo gave ${JSON.stringify(echo)}`);
    }
    ipcRenderer.send("round:report", { ok: problems.length === 0, problems });
});

ipcRenderer.on("port:gift", () => {});

function offerPort(n) {
    const { port1, port2 } = new MessageChannel();
    ipcRenderer.postMessage("port:offer", { round: n }, [port2]);
    return new Promise(resolve => {
        port1.onmessage = message => {
            port1.close();
            resolve(message.data);
        };
        port1.postMessage({ round: n });
    });
}
