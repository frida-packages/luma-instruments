export type ProcessKind = "main" | "renderer" | "utility" | "gpu" | "helper";

export interface ProcessRole {
    kind: ProcessKind;
    label: string;
    argv: string[];
    pid: number;
    parentPid: number;
}

export function identifyProcess(): ProcessRole {
    const argv = readArgv();
    const type = switchValue(argv, "type");
    const subtype = switchValue(argv, "utility-sub-type");
    const kind = kindOf(type);
    return {
        kind,
        label: labelOf(kind, type, subtype),
        argv,
        pid: Process.id,
        parentPid: parentPid(),
    };
}

function readArgv(): string[] {
    return (Process.platform === "darwin") ? darwinArgv() : linuxArgv();
}

export function switchValue(argv: string[], name: string): string | null {
    const prefix = `--${name}=`;
    const found = argv.find(argument => argument.startsWith(prefix));
    return (found !== undefined) ? found.slice(prefix.length) : null;
}

function kindOf(type: string | null): ProcessKind {
    switch (type) {
        case null:
            return "main";
        case "renderer":
            return "renderer";
        case "utility":
            return "utility";
        case "gpu-process":
            return "gpu";
        default:
            return "helper";
    }
}

function labelOf(kind: ProcessKind, type: string | null, subtype: string | null): string {
    switch (kind) {
        case "main":
            return "main process";
        case "renderer":
            return "renderer process";
        case "utility":
            return (subtype !== null) ? `utility process (${subtype})` : "utility process";
        case "gpu":
            return "GPU process";
        case "helper":
            return `${type} process`;
    }
}

function parentPid(): number {
    return new NativeFunction(Module.getGlobalExportByName("getppid"), "int", [])() as number;
}

function darwinArgv(): string[] {
    const argc = new NativeFunction(Module.getGlobalExportByName("_NSGetArgc"), "pointer", [])().readInt();
    const argv = new NativeFunction(Module.getGlobalExportByName("_NSGetArgv"), "pointer", [])().readPointer();
    const values: string[] = [];
    for (let i = 0; i !== argc; i++) {
        values.push(argv.add(i * Process.pointerSize).readPointer().readUtf8String()!);
    }
    return values;
}

function linuxArgv(): string[] {
    return File.readAllText("/proc/self/cmdline").split("\0").filter(argument => argument.length !== 0);
}
