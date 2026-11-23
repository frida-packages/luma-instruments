#pragma abi native

struct Draw {
    u8 *shareGroup;
    u64 program;
    u64 vertexArray;
    u64 elementBuffer;
    u64 mode;
    u64 count;
    u64 type;
    u64 indices;
    u64 first;
    s64 baseVertex;
};
