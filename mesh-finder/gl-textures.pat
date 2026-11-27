#pragma abi native

struct TextureUpload {
    u8 *shareGroup;
    u64 kind;
    u64 name;
    u64 generation;
    u64 internalFormat;
    u64 x;
    u64 y;
    u64 width;
    u64 height;
    u64 size;
    u8 *data;
};

struct TextureFacts {
    u64 generation;
    u64 internalFormat;
    u64 format;
    u64 type;
    u64 width;
    u64 height;
    u64 shadowed;
};
