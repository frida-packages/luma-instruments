struct JsiValue {
    u32 kind;
    padding[4];
    u8 *pointer : u64;
};

struct JsiPointerValue {
    u8 *vtable : u64;
};

struct JsiPointerValueVtable {
    u8 *invalidate : u64;
};

struct JsiBuffer {
    u8 *vtable : u64;
};

struct JsiBufferVtable {
    u8 *destructor : u64;
    u8 *deletingDestructor : u64;
    u8 *size : u64;
    u8 *data : u64;
};

struct SharedPointer {
    u8 *pointer : u64;
    u8 *control : u64;
};

struct JsiPointer {
    u8 *value : u64;
};
