#version 450

layout(set = 0, binding = 0) uniform sampler2D albedo;
layout(location = 0) in vec3 v_color;
layout(location = 1) in vec2 v_uv;
layout(location = 0) out vec4 color;

void main()
{
    color = texture(albedo, v_uv) * vec4(v_color, 1.0);
}
