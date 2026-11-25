struct BlockLiteral {
    u8 *isa : u64;
    u32 flags;
    u32 reserved;
    u8 *invoke : u64;
    u8 *descriptor : u64;
};

struct BlockDescriptor {
    u64 reserved;
    u64 size;
};
