enum { ALBEDO_WIDTH = 8, ALBEDO_HEIGHT = 4, NORMAL_MAP_SIZE = 4, BLOCK_TEXTURE_SIZE = 8, BLOCK_BYTES = 8 };

enum { ALBEDO_UNIT = 2, NORMAL_MAP_UNIT = 5, BLOCK_TEXTURE_UNIT = 3 };

#define GL_COMPRESSED_RGB_S3TC_DXT1 0x83F0
#define GL_COMPRESSED_RGB8_ETC2_FORMAT 0x9274

static const uint16_t dxt1_colors[4] = { 0xf800, 0x07e0, 0x001f, 0xffff };
static const uint8_t etc2_colors[4][3] = { { 31, 0, 0 }, { 0, 31, 0 }, { 0, 0, 31 }, { 31, 31, 31 } };

static const TextureExpectation albedo_expectation = {
    ALBEDO_WIDTH, ALBEDO_HEIGHT, "rgba8unorm", { { 255, 0, 0, 255 }, { 0, 255, 0, 255 }, { 0, 0, 255, 255 }, { 255, 255, 0, 255 } },
};

static const TextureExpectation dxt1_expectation = {
    BLOCK_TEXTURE_SIZE, BLOCK_TEXTURE_SIZE, "bc1",
    { { 255, 0, 0, 255 }, { 0, 255, 0, 255 }, { 0, 0, 255, 255 }, { 255, 255, 255, 255 } },
};

static const TextureExpectation etc2_expectation = {
    BLOCK_TEXTURE_SIZE, BLOCK_TEXTURE_SIZE, "etc2rgb8",
    { { 255, 2, 2, 255 }, { 2, 255, 2, 255 }, { 2, 2, 255, 255 }, { 255, 255, 255, 255 } },
};

static uint8_t *albedo_texels(void)
{
    uint8_t *texels = calloc(ALBEDO_WIDTH * ALBEDO_HEIGHT, 4);
    for (int y = 0; y != ALBEDO_HEIGHT; y++) {
        for (int x = 0; x != ALBEDO_WIDTH; x++) {
            uint8_t *texel = &texels[(y * ALBEDO_WIDTH + x) * 4];
            texel[0] = x * 32;
            texel[1] = y * 64;
            texel[2] = 128;
            texel[3] = 255;
        }
    }
    const int corners[4] = { 0, ALBEDO_WIDTH - 1, (ALBEDO_HEIGHT - 1) * ALBEDO_WIDTH, ALBEDO_HEIGHT * ALBEDO_WIDTH - 1 };
    for (int i = 0; i != 4; i++) {
        memcpy(&texels[corners[i] * 4], albedo_expectation.corners[i], 4);
    }
    return texels;
}

static uint8_t *normal_map_texels(void)
{
    uint8_t *texels = calloc(NORMAL_MAP_SIZE * NORMAL_MAP_SIZE, 4);
    for (int i = 0; i != NORMAL_MAP_SIZE * NORMAL_MAP_SIZE; i++) {
        texels[i * 4] = 128;
        texels[i * 4 + 1] = 128;
        texels[i * 4 + 2] = 255;
        texels[i * 4 + 3] = 255;
    }
    return texels;
}

static void dxt1_blocks(uint8_t blocks[4][BLOCK_BYTES])
{
    memset(blocks, 0, 4 * BLOCK_BYTES);
    for (int i = 0; i != 4; i++) {
        blocks[i][0] = dxt1_colors[i] & 0xff;
        blocks[i][1] = dxt1_colors[i] >> 8;
    }
}

static void etc2_blocks(uint8_t blocks[4][BLOCK_BYTES])
{
    memset(blocks, 0, 4 * BLOCK_BYTES);
    for (int i = 0; i != 4; i++) {
        blocks[i][0] = etc2_colors[i][0] << 3;
        blocks[i][1] = etc2_colors[i][1] << 3;
        blocks[i][2] = etc2_colors[i][2] << 3;
        blocks[i][3] = 0x02;
    }
}
