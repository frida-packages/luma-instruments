import { cf, createString, stringOf } from "./cf.js";

export interface EntryFacts {
    className: string;
    name: string;
    id: string;
}

export interface KernelObject {
    kind: number;
    className: string;
    id: string;
}

export const MAIN_PORT = 0;
const NAME_SIZE = 128;
export const PATH_SIZE = 512;
export const SUCCESS = 0;

const NOT_AN_OBJECT = "(not an IOKit object)";

const framework = Module.load("/System/Library/Frameworks/IOKit.framework/IOKit");

export const entryPoints = {
    serviceOpen: exported("IOServiceOpen"),
    serviceClose: exported("IOServiceClose"),
    connectCallMethod: exported("IOConnectCallMethod"),
    connectCallAsyncMethod: exported("IOConnectCallAsyncMethod"),
    connectCallScalarMethod: exported("IOConnectCallScalarMethod"),
    connectCallStructMethod: exported("IOConnectCallStructMethod"),
    connectCallAsyncScalarMethod: exported("IOConnectCallAsyncScalarMethod"),
    connectCallAsyncStructMethod: exported("IOConnectCallAsyncStructMethod"),
    connectMapMemory: exported("IOConnectMapMemory64"),
    serviceGetMatchingService: exported("IOServiceGetMatchingService"),
    serviceGetMatchingServices: exported("IOServiceGetMatchingServices"),
    serviceAddMatchingNotification: exported("IOServiceAddMatchingNotification"),
    registryEntryFromPath: exported("IORegistryEntryFromPath"),
    registryEntryCreateCFProperty: exported("IORegistryEntryCreateCFProperty"),
    registryEntrySearchCFProperty: exported("IORegistryEntrySearchCFProperty"),
    registryEntryCreateCFProperties: exported("IORegistryEntryCreateCFProperties"),
};

export const iokit = {
    objectGetClass: new NativeFunction(exported("IOObjectGetClass"), "int", ["uint", "pointer"]),
    objectRelease: new NativeFunction(exported("IOObjectRelease"), "int", ["uint"]),
    objectConformsTo: new NativeFunction(exported("IOObjectConformsTo"), "bool", ["uint", "pointer"]),
    iteratorNext: new NativeFunction(exported("IOIteratorNext"), "uint", ["uint"]),
    registryGetRootEntry: new NativeFunction(exported("IORegistryGetRootEntry"), "uint", ["uint"]),
    registryCreateIterator: new NativeFunction(exported("IORegistryCreateIterator"), "int", ["uint", "pointer", "uint", "pointer"]),
    registryEntryGetName: new NativeFunction(exported("IORegistryEntryGetName"), "int", ["uint", "pointer"]),
    registryEntryGetRegistryEntryID: new NativeFunction(exported("IORegistryEntryGetRegistryEntryID"), "int", ["uint", "pointer"]),
    registryEntryGetPath: new NativeFunction(exported("IORegistryEntryGetPath"), "int", ["uint", "pointer", "pointer"]),
    registryEntryGetChildIterator: new NativeFunction(exported("IORegistryEntryGetChildIterator"), "int", ["uint", "pointer", "pointer"]),
    registryEntryGetParentEntry: new NativeFunction(exported("IORegistryEntryGetParentEntry"), "int", ["uint", "pointer", "pointer"]),
    registryEntryFromPath: new NativeFunction(exported("IORegistryEntryFromPath"), "uint", ["uint", "pointer"]),
    registryEntryCreateCFProperty: new NativeFunction(exported("IORegistryEntryCreateCFProperty"), "pointer", ["uint", "pointer", "pointer", "uint"]),
    registryEntryCreateCFProperties: new NativeFunction(exported("IORegistryEntryCreateCFProperties"), "int", ["uint", "pointer", "pointer", "uint"]),
    serviceMatching: new NativeFunction(exported("IOServiceMatching"), "pointer", ["pointer"]),
    serviceNameMatching: new NativeFunction(exported("IOServiceNameMatching"), "pointer", ["pointer"]),
    registryEntryIDMatching: new NativeFunction(exported("IORegistryEntryIDMatching"), "pointer", ["uint64"]),
    serviceGetMatchingService: new NativeFunction(exported("IOServiceGetMatchingService"), "uint", ["uint", "pointer"]),
    serviceGetMatchingServices: new NativeFunction(exported("IOServiceGetMatchingServices"), "int", ["uint", "pointer", "pointer"]),
    serviceOpen: new NativeFunction(exported("IOServiceOpen"), "int", ["uint", "uint", "uint", "pointer"]),
    serviceClose: new NativeFunction(exported("IOServiceClose"), "int", ["uint"]),
    connectCallMethod: new NativeFunction(exported("IOConnectCallMethod"), "int",
        ["uint", "uint", "pointer", "uint", "pointer", "size_t", "pointer", "pointer", "pointer", "pointer"]),
    connectMapMemory: new NativeFunction(exported("IOConnectMapMemory64"), "int", ["uint", "uint", "uint", "pointer", "pointer", "uint"]),
};

const machErrorString = new NativeFunction(Module.getGlobalExportByName("mach_error_string"), "pointer", ["int"]);

export const taskSelf = Module.getGlobalExportByName("mach_task_self_").readU32();
export const servicePlane = Memory.allocUtf8String("IOService");

const userClientClass = Memory.allocUtf8String("IOUserClient");
const kernelObjectPattern = /^(\w+)\(0x([0-9a-f]+)\)$/;
const DESCRIPTION_SIZE = 512;
const SEND_RIGHT = 0x10000;

const machPortNames = new NativeFunction(Module.getGlobalExportByName("mach_port_names"), "int",
    ["uint", "pointer", "pointer", "pointer", "pointer"]);
const machPortKobjectDescription = new NativeFunction(Module.getGlobalExportByName("mach_port_kobject_description"), "int",
    ["uint", "uint", "pointer", "pointer", "pointer"]);
const vmDeallocate = new NativeFunction(Module.getGlobalExportByName("vm_deallocate"), "int", ["uint", "pointer", "size_t"]);

const objectKind = kindOfRoot();

export function userClientOfPort(port: number): KernelObject | null {
    const object = kernelObjectOf(port);
    return (object !== null && object.kind !== objectKind) ? object : null;
}

export function portsWithSendRights(): number[] {
    const names = Memory.alloc(Process.pointerSize);
    const nameCount = Memory.alloc(4);
    const types = Memory.alloc(Process.pointerSize);
    const typeCount = Memory.alloc(4);
    machPortNames(taskSelf, names, nameCount, types, typeCount);
    const count = nameCount.readU32();
    const [nameArray, typeArray] = [names.readPointer(), types.readPointer()];
    const ports: number[] = [];
    for (let index = 0; index !== count; index++) {
        if ((typeArray.add(index * 4).readU32() & SEND_RIGHT) !== 0) {
            ports.push(nameArray.add(index * 4).readU32());
        }
    }
    vmDeallocate(taskSelf, nameArray, count * 4);
    vmDeallocate(taskSelf, typeArray, count * 4);
    return ports;
}

function kindOfRoot(): number {
    const root = iokit.registryGetRootEntry(MAIN_PORT);
    const kind = kernelObjectOf(root)!.kind;
    iokit.objectRelease(root);
    return kind;
}

function kernelObjectOf(port: number): KernelObject | null {
    const kind = Memory.alloc(4);
    const address = Memory.alloc(8);
    const description = Memory.alloc(DESCRIPTION_SIZE);
    if (machPortKobjectDescription(taskSelf, port, kind, address, description) !== SUCCESS) {
        return null;
    }
    const match = kernelObjectPattern.exec(description.readUtf8String()!);
    return (match !== null) ? { kind: kind.readU32(), className: match[1], id: `0x${match[2]}` } : null;
}

export function entryFacts(entry: number): EntryFacts {
    return { className: classOf(entry), name: nameOf(entry), id: `0x${entryIdOf(entry).toString(16)}` };
}

function classOf(object: number): string {
    const name = Memory.alloc(NAME_SIZE);
    return (iokit.objectGetClass(object, name) === SUCCESS) ? name.readUtf8String()! : NOT_AN_OBJECT;
}

function nameOf(entry: number): string {
    const name = Memory.alloc(NAME_SIZE);
    return (iokit.registryEntryGetName(entry, name) === SUCCESS) ? name.readUtf8String()! : "";
}

function entryIdOf(entry: number): UInt64 {
    const id = Memory.alloc(8);
    iokit.registryEntryGetRegistryEntryID(entry, id);
    return id.readU64();
}

export function childrenOf(entry: number): number[] {
    const iterator = Memory.alloc(4);
    iokit.registryEntryGetChildIterator(entry, servicePlane, iterator);
    return drain(iterator.readU32());
}

export function drain(iterator: number): number[] {
    const objects: number[] = [];
    for (let object = iokit.iteratorNext(iterator); object !== 0; object = iokit.iteratorNext(iterator)) {
        objects.push(object);
    }
    iokit.objectRelease(iterator);
    return objects;
}

export function isUserClient(entry: number): boolean {
    return iokit.objectConformsTo(entry, userClientClass) !== 0;
}

export function stringProperty(entry: number, key: string): string | null {
    const name = createString(key);
    const value = iokit.registryEntryCreateCFProperty(entry, name, NULL, 0);
    cf.release(name);
    if (value.isNull()) {
        return null;
    }
    const text = stringOf(value);
    cf.release(value);
    return text;
}

export function resultText(result: number): string {
    if (result === SUCCESS) {
        return "success";
    }
    return `0x${(result >>> 0).toString(16)} ${machErrorString(result).readUtf8String()}`;
}

export function describeEntry(facts: EntryFacts): string {
    return (facts.name !== "" && facts.name !== facts.className) ? `${facts.className} "${facts.name}"` : facts.className;
}

function exported(name: string): NativePointer {
    return framework.getExportByName(name);
}
