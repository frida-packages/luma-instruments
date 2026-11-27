struct ImageFacts {
    u64 order;
    u64 width;
    u64 height;
    u64 format;
    u64 tiling;
    u64 memory;
    u64 memoryOffset;
    u64 backing;
    u8 *mapped : u64;
    u64 mappedOffset;
    u64 mappedSize;
};

struct ViewFacts {
    u64 image;
    u64 format;
};

struct ImageCopy {
    u64 source;
    u64 image;
    u64 bufferOffset;
    u64 rowLength;
    u64 imageHeight;
    u64 x;
    u64 y;
    u64 width;
    u64 height;
};
