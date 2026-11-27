#version 450

layout(location = 0) in vec3 inNormal;
layout(location = 1) in vec2 inUV;
layout(location = 2) in vec3 inPos;
layout(push_constant) uniform Transform { mat4 mvp; } transform;
layout(location = 0) out vec3 v_color;
layout(location = 1) out vec2 v_uv;

void main()
{
    gl_Position = transform.mvp * vec4(inPos, 1.0);
    v_color = inNormal * 0.5 + 0.5;
    v_uv = inUV;
}
