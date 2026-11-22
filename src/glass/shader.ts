export const vertexSource = `#version 300 es
in vec2 aPosition;
out vec2 uv;
void main() {
  uv = vec2(aPosition.x * .5 + .5, .5 - aPosition.y * .5);
  gl_Position = vec4(aPosition, 0., 1.);
}`

export const fragmentSource = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 outputColor;
uniform sampler2D uScene, uWater, uCrystal;
uniform highp sampler2DArray uBrush;
uniform vec2 uCover, uOffset, uPixels, uField;
uniform vec4 uState, uDensity;
uniform float uRefraction, uSceneTime, uWaterStart;

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * .1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}

vec3 viewAt(vec2 p, float blur) {
  vec2 scene = p * uCover + uOffset;
  float waves = smoothstep(uWaterStart, min(uWaterStart + .22, 1.), scene.y);
  scene.y += waves * (.0022 * sin(scene.y * 125. + scene.x * 24. - uSceneTime * 2.8)
                    + .0011 * sin(scene.y * 256. - scene.x * 39. + uSceneTime * 4.1));
  return textureLod(uScene, clamp(scene, 0., 1.), blur).rgb;
}

float waterAt(vec2 p) {
  return texture(uWater, p).r;
}

void main() {
  vec2 point = uv * uPixels / max(uPixels.y, 1.);
  vec2 pixel = 1. / uPixels;
  vec4 brush = vec4(texture(uBrush,vec3(uv,0.)).a, texture(uBrush,vec3(uv,1.)).a,
                    texture(uBrush,vec3(uv,2.)).a, texture(uBrush,vec3(uv,3.)).a);
  vec3 water = texture(uWater, uv).rgb;
  vec2 ice = texture(uCrystal, uv).rg;
  float grain = hash(floor(uv * uPixels));
  float cloud = noise(point * 6.2) * .63 + noise(point * 17.) * .27 + noise(point * 41.) * .1;
  float edge = min(min(uv.x, 1. - uv.x) * min(uPixels.x / uPixels.y, 1.55), min(uv.y, 1. - uv.y));
  float spotEdge = noise(point * 58.) * .64 + noise(point * 156.) * .36;
  float melt = smoothstep(.045, .78, brush.g * (.80 + .38 * spotEdge));
  float irregularity = (spotEdge - .52) * (1. - abs(2. * brush.r - 1.)) * .34;
  float wiped = brush.r + irregularity;
  float clearedRain = smoothstep(.10, .94, wiped);
  float caughtWater = smoothstep(.43, .68, noise(vec2(point.x * 81., point.y * 19.)));
  float wipedRim = smoothstep(.08, .29, wiped) * (1. - smoothstep(.30, .66, wiped)) * caughtWater;
  float thawRim = smoothstep(.13, .41, brush.g) * (1. - smoothstep(.49, .82, brush.g));
  float runoff = water.g * smoothstep(.02, .75, uState.x);
  float clean = clamp(clearedRain * uState.x + melt * uState.y + brush.b * uState.z + brush.a * uState.w, 0., 1.);
  float iceField = (1. - smoothstep(.00, .245, edge)) * .68 + ice.g * .54 + cloud * .18;
  float iceGrowth = smoothstep(.37, .74, uState.y * uDensity.y * .72 + iceField * .43 - melt * .80 - (1. - uState.y) * spotEdge * .14);
  float crystal = ice.r * iceGrowth;
  float frostPatch = smoothstep(.39, .74, cloud * .55 + iceField * .39 + spotEdge * .19);
  float frost = clamp((iceField + ice.r * .06 + frostPatch * .18 + .09) * iceGrowth * (1. - melt), 0., 1.);
  float vapor = uState.z * uDensity.z * (.62 + cloud * .39) * (1. - brush.b);
  float dustLocal = smoothstep(.09, .95, cloud + .19 * noise(vec2(point.x * 22. + point.y * 6., point.y * 4.)));
  float deposits = noise(vec2(point.x * 12. + point.y * 5., point.y * 73.));
  float mineral = smoothstep(.66, .86, deposits) * smoothstep(.38, .75, cloud);
  float dust = smoothstep(.36, .83, uState.w * .69 + cloud * .31 - runoff * .91)
             * uDensity.w * (dustLocal + mineral * .13) * (1. - brush.a);
  float rim = smoothstep(.08, .24, brush.a) * (1. - smoothstep(.34, .66, brush.a)) * uState.w * uDensity.w;

  float film = uState.x * (1. - clearedRain) * (.83 + cloud * .17);
  float rewetted = smoothstep(.04, .61, water.b) * (1. - smoothstep(.65, .99, wiped)) * uState.x;
  float streak = max(water.b * uState.x * (1. - clearedRain), rewetted * .53);
  float glassBlur = mix(.47, .03, clean) + film * 2.58 + streak * .93 + frost * 6.2 + vapor * 5.25 + dust * 2.75;
  vec3 base = viewAt(uv, glassBlur);
  float sideLight = mix(.70, 1.12, smoothstep(.01, .83, uv.x + uv.y * .24));
  base = mix(base, vec3(.78,.84,.86), clamp(frost * .63 + vapor * .49 + dust * .32, 0., .77) * sideLight);
  base = mix(base, base * vec3(.93,.96,1.01), film * .40);
  if (wipedRim * uState.x > .012) {
    float edgeWater = wipedRim * uState.x;
    float wetGlint = edgeWater * max(water.r, water.b * .65);
    base = mix(base, viewAt(uv + vec2(0., -.005 - wetGlint * .007), 1.5),
      edgeWater * (.10 + wetGlint * .57));
    base += vec3(.23,.32,.38) * wetGlint * .16;
  }
  if (uState.y > .005) {
    float iceShadow = texture(uCrystal, uv - vec2(1.35, 1.65) / uField).r * iceGrowth;
    base += (vec3(.36,.42,.46) * crystal * (.57 + grain * .35)
      - vec3(.113,.126,.133) * iceShadow) * (1. - melt);
  }
  base += vec3(.28,.36,.39) * thawRim * uState.y * sideLight * (.15 + spotEdge * .19);
  base = mix(base, viewAt(uv + (spotEdge - .5) * pixel * 3., .55), melt * uState.y * .93);
  base += vec3(.63,.73,.72) * rim * .17;
  base += (grain - .42) * (vapor * .052 + dust * .14 + frost * .07);
  float micro = step(.82, hash(floor(uv * uPixels * .63))) * step(.58, grain);
  base += micro * (vapor * .026 + dust * .14 + frost * .06) * sideLight;
  if (vapor > .008) {
    vec2 grid = uv * uPixels / 4.75;
    vec2 cell = floor(grid);
    vec2 site = vec2(hash(cell + 2.), hash(cell - 4.)) * .68 + .16;
    vec2 beadUV = fract(grid) - site;
    float radius = .052 + hash(cell + 9.) * .18;
    float speck = 1. - smoothstep(radius * .47, radius + .07, length(beadUV));
    float glint = 1. - smoothstep(radius * .20, radius * .77 + .03, length(beadUV + radius * vec2(.31, .51)));
    base += (vec3(.41,.50,.53) * glint - base * speck * .27) * vapor;
  }
  if (streak > .018) {
    vec2 sx = vec2(1.35 / uField.x, 0.);
    float slope = texture(uWater, uv - sx).b - texture(uWater, uv + sx).b;
    vec3 lightUnderRun = viewAt(uv + vec2(slope * .007, -.009), 2.4);
    base = mix(base, lightUnderRun * .93, streak * .41);
  }

  float wet = uState.x * uDensity.x * (1. - clearedRain)
            + (melt * .82 + thawRim * .28) * uState.y + uState.y * uState.x * .37;
  wet = max(wet, wipedRim * (.26 + spotEdge * .35) * uState.x + rewetted * .53);
  if (water.r > .012 && wet > .001) {
    vec2 stepSize = 1.03 / uField;
    vec2 normal = vec2(waterAt(uv - vec2(stepSize.x, 0)) - waterAt(uv + vec2(stepSize.x, 0)),
                       waterAt(uv - vec2(0, stepSize.y)) - waterAt(uv + vec2(0, stepSize.y)));
    float body = smoothstep(.025, .40, water.r);
    vec2 aspect = vec2(uPixels.y/uPixels.x, 1.);
    vec2 bend = normal * aspect * (.036 + water.r * .034) * uRefraction;
    vec3 refracted = viewAt(uv - bend + vec2(0., -.005), mix(.45, 1.4, water.r));
    vec3 reflected = viewAt(uv + bend * 1.24 + vec2(.02,-.12) * aspect, 2.1);
    float slope = length(normal);
    float side = dot(normal, vec2(-.42,-.91));
    float arc = smoothstep(.47,.97,side / max(slope,.001)) * smoothstep(.12,.57,slope);
    float caustic = pow(max(0., dot(normal, vec2(.56,.83))), 2.0);
    float specular = pow(clamp(side * 1.37, 0., 1.), 6.0);
    float fresnel = smoothstep(.12, .78, slope);
    vec3 glassLight = mix(vec3(.64,.72,.80), sqrt(max(reflected, vec3(0.))), .51);
    float rim = smoothstep(.045,.22,water.r) * (1. - smoothstep(.37,.65,water.r));
    float sheen = smoothstep(.045,.63,side) * (.22 + rim * .47);
    float farEdge = smoothstep(.07,.62,-side) * max(rim,body * .45);
    vec3 lens = mix(refracted, reflected, fresnel * .18) * (.82 + caustic * .62 - farEdge * .55);
    lens += glassLight * (sheen * .54 + specular * .48 + fresnel * rim * .11 + arc * rim * .41);
    float cut = smoothstep(.026, .26, water.r);
    base = mix(base, lens, clamp(max(body, cut * fresnel * .88) * wet, 0., .97));
  }
  base += vec3(.23,.31,.33) * runoff * .15 * uState.w;
  outputColor = vec4(base, 1.);
}`
