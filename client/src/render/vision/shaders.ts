/**
 * GLSL ES 3.0 shaders for the Darkwood-style vision system.
 *
 * The visibility mask is a half-resolution RenderTexture with three channels:
 *   B = the viewer's own vision (flashlight cone + proximity circle), with distance falloff
 *   G = the viewer's 360-degree line of sight (binary, long range)
 *   R = light sources (campfires, lit generators, flares), with distance falloff
 * visible = max(B, R * G): you see your own cone, plus lit areas you have line of sight to.
 */

/** Filter vertex shader that also outputs the fragment's screen-space UV for mask lookups. */
export const screenVertex = /* glsl */ `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vScreenUV;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
uniform vec4 uGlobalFrame;
uniform vec2 uScreenSize;

vec4 filterVertexPosition(void)
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
    vec2 screenPos = aPosition * uOutputFrame.zw + uOutputFrame.xy + uGlobalFrame.xy;
    vScreenUV = screenPos / uScreenSize;
}
`;

const maskLookup = /* glsl */ `
float visibilityAt(vec2 screenUV)
{
    vec4 m = texture(uMask, screenUV * uMaskScale);
    float los = smoothstep(0.25, 0.75, m.g);
    return clamp(max(m.b, m.r * los), 0.0, 1.0);
}
`;

/**
 * Post-process: full colour inside vision, desaturated and dimmed outside.
 * out = mix(desaturate(scene) * dim, scene, mask), plus vignette, film grain and flicker.
 */
export const visionFragment = /* glsl */ `
precision highp float;
in vec2 vTextureCoord;
in vec2 vScreenUV;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uMask;
uniform vec2 uMaskScale;
uniform vec2 uScreenSize;
uniform float uTime;
uniform float uOutsideDim;
uniform float uGrain;
uniform float uFlicker;
uniform float uTerror;
uniform float uBlind;
uniform float uDamage;
uniform vec3 uTint;

${maskLookup}

float hash(vec2 p)
{
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

void main(void)
{
    vec4 scene = texture(uTexture, vTextureCoord);
    float vis = visibilityAt(vScreenUV);

    float lum = dot(scene.rgb, vec3(0.299, 0.587, 0.114));
    vec3 outside = vec3(lum) * vec3(0.78, 0.86, 0.92) * uOutsideDim;
    vec3 inside = scene.rgb * uTint * (0.5 + 0.8 * vis);
    vec3 col = mix(outside, inside, smoothstep(0.02, 0.45, vis));

    // Terror radius: the world drains of colour and darkens as Zach closes in.
    float tl = dot(col, vec3(0.3333));
    col = mix(col, vec3(tl) * vec3(1.05, 0.82, 0.8), uTerror * 0.4);
    col *= 1.0 - uTerror * 0.3;
    col *= uFlicker;

    vec2 d = vScreenUV - 0.5;
    d.x *= uScreenSize.x / uScreenSize.y;
    float vig = smoothstep(1.0, 0.3, length(d) + uTerror * 0.18);
    col *= mix(0.2, 1.0, vig);
    col += vec3(0.4, 0.0, 0.0) * uDamage * (1.0 - vig * 0.7);

    col = mix(col, vec3(0.96, 0.93, 0.86), uBlind);

    float n = hash(vScreenUV * uScreenSize + fract(uTime * 7.31) * 311.0) - 0.5;
    col += n * uGrain;

    finalColor = vec4(max(col, 0.0), 1.0);
}
`;

/**
 * Entity occlusion: dynamic entities are multiplied by a hard threshold of the mask, so they
 * are fully invisible outside vision even when physically close.
 */
export const entityMaskFragment = /* glsl */ `
precision highp float;
in vec2 vTextureCoord;
in vec2 vScreenUV;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uMask;
uniform vec2 uMaskScale;
uniform vec2 uScreenSize;
uniform float uThreshold;

${maskLookup}

void main(void)
{
    vec4 c = texture(uTexture, vTextureCoord);
    finalColor = c * step(uThreshold, visibilityAt(vScreenUV));
}
`;
