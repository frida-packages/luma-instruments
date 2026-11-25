struct TypeInfo {
    u8 *vtable : u64;
    u8 *name : u64;
};

struct VtablePrefix {
    s64 offsetToTop;
    u8 *typeInfo : u64;
};

struct AppleArm64LongString {
    u8 *data : u64;
    u64 size;
    u64 capacity;
};

struct AppleArm64ShortString {
    u8 text[23];
    u8 size;
};

struct StandardLongString {
    u64 capacity;
    u64 size;
    u8 *data : u64;
};

struct StandardShortString {
    u8 size;
    u8 text[23];
};
