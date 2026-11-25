export const xpcEntryPoints = {
    sendMessage: exported("xpc_connection_send_message"),
    sendMessageWithReply: exported("xpc_connection_send_message_with_reply"),
    sendMessageWithReplySync: exported("xpc_connection_send_message_with_reply_sync"),
    setEventHandler: exported("xpc_connection_set_event_handler"),
};

export const xpcTypes = {
    dictionary: exported("_xpc_type_dictionary"),
    error: exported("_xpc_type_error"),
    array: exported("_xpc_type_array"),
    string: exported("_xpc_type_string"),
    int64: exported("_xpc_type_int64"),
    uint64: exported("_xpc_type_uint64"),
    bool: exported("_xpc_type_bool"),
    double: exported("_xpc_type_double"),
    date: exported("_xpc_type_date"),
    data: exported("_xpc_type_data"),
    uuid: exported("_xpc_type_uuid"),
    null: exported("_xpc_type_null"),
    connection: exported("_xpc_type_connection"),
};

export const xpcClasses = {
    connection: objcClass("OS_xpc_connection"),
    serializer: objcClass("OS_xpc_serializer"),
};

export const xpcErrors = {
    connectionInvalid: exported("_xpc_error_connection_invalid"),
};

export const xpc = {
    getType: new NativeFunction(exported("xpc_get_type"), "pointer", ["pointer"]),
    typeGetName: new NativeFunction(exported("xpc_type_get_name"), "pointer", ["pointer"]),
    retain: new NativeFunction(exported("xpc_retain"), "pointer", ["pointer"]),
    release: new NativeFunction(exported("xpc_release"), "void", ["pointer"]),
    connectionCreate: new NativeFunction(exported("xpc_connection_create"), "pointer", ["pointer", "pointer"]),
    connectionCreateFromEndpoint: new NativeFunction(exported("xpc_connection_create_from_endpoint"), "pointer", ["pointer"]),
    endpointCreate: new NativeFunction(exported("xpc_endpoint_create"), "pointer", ["pointer"]),
    connectionSetEventHandler: new NativeFunction(exported("xpc_connection_set_event_handler"), "void", ["pointer", "pointer"]),
    connectionSetTargetQueue: new NativeFunction(exported("xpc_connection_set_target_queue"), "void", ["pointer", "pointer"]),
    connectionActivate: new NativeFunction(exported("xpc_connection_activate"), "void", ["pointer"]),
    connectionCancel: new NativeFunction(exported("xpc_connection_cancel"), "void", ["pointer"]),
    connectionSendMessageWithReply: new NativeFunction(exported("xpc_connection_send_message_with_reply"), "void",
        ["pointer", "pointer", "pointer", "pointer"]),
    connectionGetName: new NativeFunction(exported("xpc_connection_get_name"), "pointer", ["pointer"]),
    connectionGetPid: new NativeFunction(exported("xpc_connection_get_pid"), "int", ["pointer"]),
    dictionaryCreate: new NativeFunction(exported("xpc_dictionary_create"), "pointer", ["pointer", "pointer", "size_t"]),
    dictionaryApply: new NativeFunction(exported("xpc_dictionary_apply"), "bool", ["pointer", "pointer"]),
    dictionaryGetCount: new NativeFunction(exported("xpc_dictionary_get_count"), "size_t", ["pointer"]),
    dictionaryGetValue: new NativeFunction(exported("xpc_dictionary_get_value"), "pointer", ["pointer", "pointer"]),
    dictionaryGetRemoteConnection: new NativeFunction(exported("xpc_dictionary_get_remote_connection"), "pointer", ["pointer"]),
    arrayGetCount: new NativeFunction(exported("xpc_array_get_count"), "size_t", ["pointer"]),
    arrayGetValue: new NativeFunction(exported("xpc_array_get_value"), "pointer", ["pointer", "size_t"]),
    stringGetStringPtr: new NativeFunction(exported("xpc_string_get_string_ptr"), "pointer", ["pointer"]),
    stringGetLength: new NativeFunction(exported("xpc_string_get_length"), "size_t", ["pointer"]),
    int64GetValue: new NativeFunction(exported("xpc_int64_get_value"), "int64", ["pointer"]),
    uint64GetValue: new NativeFunction(exported("xpc_uint64_get_value"), "uint64", ["pointer"]),
    boolGetValue: new NativeFunction(exported("xpc_bool_get_value"), "bool", ["pointer"]),
    doubleGetValue: new NativeFunction(exported("xpc_double_get_value"), "double", ["pointer"]),
    dateGetValue: new NativeFunction(exported("xpc_date_get_value"), "int64", ["pointer"]),
    dataGetBytesPtr: new NativeFunction(exported("xpc_data_get_bytes_ptr"), "pointer", ["pointer"]),
    dataGetLength: new NativeFunction(exported("xpc_data_get_length"), "size_t", ["pointer"]),
    uuidGetBytes: new NativeFunction(exported("xpc_uuid_get_bytes"), "pointer", ["pointer"]),
};

export function connectionName(connection: NativePointer): string | null {
    const name = xpc.connectionGetName(connection);
    return name.isNull() ? null : name.readCString();
}

export function isOfType(object: NativePointer, type: NativePointer): boolean {
    return xpc.getType(object).equals(type);
}

export function typeName(object: NativePointer): string {
    return xpc.typeGetName(xpc.getType(object)).readCString()!;
}

function objcClass(name: string): NativePointer {
    const getClass = new NativeFunction(exported("objc_getClass"), "pointer", ["pointer"]);
    return getClass(Memory.allocUtf8String(name));
}

function exported(name: string): NativePointer {
    return Module.getGlobalExportByName(name);
}
