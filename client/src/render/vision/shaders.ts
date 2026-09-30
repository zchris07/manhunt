/**
 * GLSL ES 3.0 shaders for the vision system.
 *
 * The visibility mask is a half-resolution RenderTexture with three channels:
 *   B = the viewer's own light: flashlight cone (runs until it hits something) and the small
 *       proximity circle, with distance falloff; plus see-through light (night vision
 *       goggles, the Hemp Battery) at 70%, which ignores walls
 *   G = the viewer's 360-degree line of sight (binary, long range)
 *   R = light sources (campfires, lamps, running generators), with distance falloff
 * The ground is lit where max(B, R * G) is high, in a warm, desaturated sepia. Everywhere
 * else is fog of war: the layout stays faintly visible in grey (the darkness is lifted
 * 20%), but characters, items and objectives are drawn only inside B, your own light.
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
/** x: how lit the ground is, y: your own light only. */
vec2 visibilityAt(vec2 screenUV)
{
    vec4 m = texture(uMask, screenUV * uMaskScale);
    float los = smoothstep(0.25, 0.75, m.g);
    float own = clamp(m.b, 0.0, 1.0);
    return vec2(clamp(max(own, m.r * los), 0.0, 1.0), own);
}

/** Darkwood grade: flatter colours, pulled toward a warm sepia. */
vec3 gradeLit(vec3 c)
{
    float lum = dot(c, vec3(0.299, 0.587, 0.114));
    return mix(vec3(lum), c, uSaturation) * uTint;
}
`;

/**
 * Post-process for the world layer: lit areas in warm, flat colour; the rest is a faint
 * grey fog of war you can still read the layout through. Plus vignette, grain and a
 * damage flash.
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
uniform float uGrain;
uniform float uFlicker;
uniform float uDamage;
uniform float uSaturation;
uniform float uFog;
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
    float vis = visibilityAt(vScreenUV).x;

    float lum = dot(scene.rgb, vec3(0.299, 0.587, 0.114));
    // Fog of war: colourless, dim, slightly cold.
    vec3 fog = vec3(lum) * uFog * vec3(0.94, 0.98, 1.0) + vec3(0.006);
    vec3 lit = gradeLit(scene.rgb) * (vis * 1.45) * uFlicker;
    vec3 col = mix(fog, max(lit, fog), smoothstep(0.02, 0.3, vis));

    vec2 d = vScreenUV - 0.5;
    d.x *= uScreenSize.x / uScreenSize.y;
    float vig = smoothstep(1.0, 0.25, length(d));
    col *= mix(0.35, 1.0, vig);
    col += vec3(0.5, 0.0, 0.03) * uDamage * (1.0 - vig * 0.6);

    float n = hash(vScreenUV * uScreenSize + fract(uTime * 7.31) * 311.0) - 0.5;
    col += n * uGrain;

    finalColor = vec4(max(col, 0.0), 1.0);
}
`;

/**
 * Entity occlusion: characters, items and objectives are cut by a hard threshold of your own
 * light (the flashlight cone, the proximity circle and see-through light), so they are fully
 * invisible in the fog even when physically close or standing under a lamp. Inside, they get
 * the same grade and brightness as the ground around them.
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
uniform float uSaturation;
uniform vec3 uTint;

${maskLookup}

void main(void)
{
    vec4 c = texture(uTexture, vTextureCoord);
    vec2 v = visibilityAt(vScreenUV);
    float k = min(1.0, max(v.x, 0.35) * 1.12);
    vec3 rgb = c.a > 0.0 ? gradeLit(c.rgb / c.a) * c.a : c.rgb;
    finalColor = vec4(rgb * k, c.a) * step(uThreshold, v.y);
}
`;
