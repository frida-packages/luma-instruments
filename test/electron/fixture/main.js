const { app, BrowserWindow, ipcMain, MessageChannelMain } = require("electron");
const path = require("path");

const TICK_MS = Number(process.env.FIXTURE_TICK_MS ?? 1000);
const floodPerTick = Number(process.env.FIXTURE_FLOOD ?? 0);
const roles = new Map();
let ticks = 0;
let syncCounter = 0;

app.dock?.hide();

app.on("web-contents-created", (_event, contents) => {
    if (process.env.FIXTURE_STUB_DEVTOOLS) {
        contents.openDevTools = options => {
            say(`devtools ${contents.id} ${JSON.stringify(options ?? null)}`);
        };
    }
    contents.on("render-process-gone", (_e, details) => say(`gone ${contents.id} ${details.reason}`));
});

app.on("window-all-closed", () => {});

app.whenReady().then(() => {
    serveIpc();
    const isolated = openWindow("isolated", {
        preload: path.join(__dirname, "preload-isolated.js"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
    });
    isolated.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    isolated.webContents.on("will-navigate", event => event.preventDefault());
    const open = openWindow("open", {
        preload: path.join(__dirname, "preload-open.js"),
        contextIsolation: false,
        sandbox: false,
        nodeIntegration: true,
        webSecurity: false,
    });
    open.webContents.ipc.handle("local:whoami", event => ({ id: event.sender.id, role: "open" }));
    openWindow("victim", {});
    setInterval(tick, TICK_MS);
    say(`ready ${process.versions.electron} ${process.pid}`);
});

function serveIpc() {
    ipcMain.handle("math:add", (_event, a, b) => a + b);
    ipcMain.handle("math:fail", () => {
        throw new Error("refused on purpose");
    });
    ipcMain.handle("data:slow", async (_event, n) => {
        await new Promise(resolve => setTimeout(resolve, 30));
        return { n, bytes: Buffer.from([1, 2, 3, 250]), nested: { list: [1, "two", null], when: new Date(0) } };
    });
    ipcMain.on("log:note", (event, text) => {
        event.reply("log:ack", text.length);
    });
    ipcMain.on("state:get-sync", event => {
        syncCounter++;
        event.returnValue = { counter: syncCounter, platform: process.platform };
    });
    ipcMain.on("port:offer", event => {
        const [port] = event.ports;
        port.on("message", message => port.postMessage({ echo: message.data }));
        port.start();
    });
    ipcMain.on("flood", () => {});
    ipcMain.on("round:report", (event, report) => {
        const role = roles.get(event.sender.id) ?? "?";
        say(`round ${role} ${report.ok ? "ok" : `BROKEN ${JSON.stringify(report.problems)}`}`);
    });
}

function openWindow(role, webPreferences) {
    const window = new BrowserWindow({ show: false, width: 640, height: 480, title: `Fixture ${role}`, webPreferences });
    roles.set(window.webContents.id, role);
    const page = (role === "victim") ? "victim.html" : `${role}.html`;
    window.loadFile(path.join(__dirname, page));
    return window;
}

function tick() {
    ticks++;
    for (const window of BrowserWindow.getAllWindows()) {
        const contents = window.webContents;
        if (contents.isDestroyed() || contents.isCrashed() || roles.get(contents.id) === "victim") {
            continue;
        }
        contents.send("tick", ticks, floodPerTick);
        if (ticks === 2) {
            const { port1, port2 } = new MessageChannelMain();
            contents.postMessage("port:gift", { hello: roles.get(contents.id) }, [port2]);
            port1.close();
        }
    }
}

function say(text) {
    process.stdout.write(`FIXTURE ${text}\n`);
}
