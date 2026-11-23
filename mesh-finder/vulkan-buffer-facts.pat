struct BufferFacts {
    u64 size;
    u64 memory;
    u64 memoryOffset;
    u64 order;
    u64 backing;
    u8 *mapped : u64;
    u64 mappedOffset;
    u64 mappedSize;
};

struct Mapping {
    u8 *mapped : u64;
    u64 mappedSize;
};
