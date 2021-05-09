/* globals generate_terrain, generate_mesh, calc_normals, line_seg_triangle_intersection, vec3 */
// Basic Flight Simulator
// Authors: Mark Morykan, Jonah Beers
'use strict';

// Global WebGL context variable 
let gl;
let rotation;  // array of the flyer's current orientation
let flyerPosition;  // array of the flyer's position

// Define glMatrix mat4
const mat4 = glMatrix.mat4;


window.addEventListener('load', function init() {
    // Get the HTML5 canvas object from it's ID
    const canvas = document.getElementById('webgl-canvas');
    if (!canvas) { window.alert('Could not find #webgl-canvas'); return; }

    // Get the WebGL context (save into a global variable)
    gl = canvas.getContext('webgl2');
    if (!gl) { window.alert("WebGL isn't available"); return; }

    // Configure WebGL
    gl.viewport(0, 0, canvas.width, canvas.height); // this is the region of the canvas we want to draw on (all of it)
    gl.clearColor(0.0, 0.8, 1.0, 1.0); // setup the background color
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    
    // Initialize the WebGL program, buffers, and events
    gl.program = initProgram();
    initBuffers();
    initEvents();

    // Render the static scene
    onWindowResize();
    render();
});


/**
 * Initializes the WebGL program.
 */
function initProgram() {
    // Compile shaders
    // Vertex Shader
    let vert_shader = compileShader(gl, gl.VERTEX_SHADER,
        `#version 300 es
        precision mediump float;

        uniform mat4 uModelViewMatrix;
        uniform mat4 uProjectionMatrix;
        uniform mat4 uView;
        uniform vec4 uLight;

        in vec4 aPosition;
        in vec3 aNormal;
        in vec3 aColor;

        out vec3 vNormalVector;
        out vec3 vLightVector;
        out vec3 vEyeVector;
        flat out vec3 vColor;

        void main() {
            vec4 lightPos = uView * uLight;
            vec4 P = uModelViewMatrix * aPosition;
            vNormalVector = mat3(uModelViewMatrix) * aNormal;
            vLightVector = lightPos.w == 1.0 ? P.xyz - lightPos.xyz : lightPos.xyz;
            vEyeVector = vec3(0, 0, 1) - P.xyz;
            gl_Position = uProjectionMatrix * P;
            vColor = aColor;
        }`
    );
    // Fragment Shader - Phong Shading and Reflections
    let frag_shader = compileShader(gl, gl.FRAGMENT_SHADER,
        `#version 300 es
        precision mediump float;

        // Light and material properties
        const vec3 lightColor = vec3(1.0, 1.0, 1.0);
        const vec3 materialAmbient = vec3(0.0, 0.5, 0.0);
        const vec3 materialDiffuse = vec3(0.0, 0.5, 0.0);
        const vec3 materialSpecular = vec3(0.0, 0.5, 0.0);
        const float materialShininess = 1.0;

        // Vectors (varying variables from vertex shader)
        flat in vec3 vColor;
        in vec3 vNormalVector;
        in vec3 vLightVector;
        in vec3 vEyeVector;

        out vec4 fragColor;

        void main() {
            // Normalize vectors
            vec3 N = normalize(vNormalVector);
            vec3 L = normalize(vLightVector);
            vec3 E = normalize(vEyeVector);

            // Compute lighting
            float diffuse = dot(-L, N);
            float specular = 0.0;
            if (diffuse < 0.0) {
                diffuse = 0.0;
            } else {
                vec3 R = reflect(L, N);
                specular = pow(max(dot(R, E), 0.0), materialShininess);
            }
            
            // Compute final color
            fragColor.rgb = ((materialAmbient + materialDiffuse * diffuse) *
            vColor + materialSpecular * specular) * lightColor;
            fragColor.a = 1.0;
        }`
    );

    // Link the shaders into a program and use them with the WebGL context
    let program = linkProgram(gl, vert_shader, frag_shader);
    gl.useProgram(program);
    
    // Get the attribute indices
    program.aPosition = gl.getAttribLocation(program, 'aPosition');
    program.aNormal = gl.getAttribLocation(program, 'aNormal');
    program.aColor = gl.getAttribLocation(program, 'aColor');

    // Get the uniform indices
    program.uModelViewMatrix = gl.getUniformLocation(program, 'uModelViewMatrix');
    program.uProjectionMatrix = gl.getUniformLocation(program, 'uProjectionMatrix');
    program.uView = gl.getUniformLocation(program, 'uView');
    program.uLight = gl.getUniformLocation(program, 'uLight');

    return program;
}

/**
 * Initialize event listener for keyboard input.
 */
function initEvents() {
    window.addEventListener('keydown', changePosition); // setup keyboard controls
}

/**
 * Updates the projection matrix.
 */
function updateProjectionMatrix() {
    let [w, h] = [gl.canvas.width, gl.canvas.height];
    let p = mat4.perspective(mat4.create(), deg2rad(90), w/h, 0.01, 20);
    gl.uniformMatrix4fv(gl.program.uProjectionMatrix, false, p);
}

/**
 * Returns an array of different shades of green based 
 * on the height of the terrain in each location.
 */
function getColors() {
    let colors = []
    for (let row of gl.terrain_data) {
        for (let yVal of row) {
            colors.push(0, (1+yVal) / 2, 0);
        }
    }
    return colors;
}

/**
 * Initialize the data buffers.
 */
function initBuffers() {
    gl.terrain_data = generate_terrain(7, 0.006);  // A height map of the generated terrain
    [gl.coords, gl.indices] = generate_mesh(gl.terrain_data);  // the coordinates and indices of the terrain
    setInitialPosition(gl.terrain_data); // set flyer position in the middle of the terrain
    let normals = calc_normals(gl.coords, gl.indices);  // the normal coordinates for lighting
    let colors = getColors();  // the color array making lower elevations darker shades of green
    
    // Create and bind VAO
    gl.terrainVAO = gl.createVertexArray();
    gl.bindVertexArray(gl.terrainVAO);

    // Load the vertex coordinate data onto the GPU and associate with attribute
    let posBuffer = gl.createBuffer(); // create a new buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer); // bind to the new buffer
    gl.bufferData(gl.ARRAY_BUFFER, gl.coords, gl.STATIC_DRAW); // load the data into the buffer
    gl.vertexAttribPointer(gl.program.aPosition, 3, gl.FLOAT, false, 0, 0); // associate the buffer with "aPosition" as length-3 vectors of floats
    gl.enableVertexAttribArray(gl.program.aPosition); // enable this set of data

    // Load the index data onto the GPU
    let indBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, gl.indices, gl.STATIC_DRAW);

    // Load the normal data onto the GPU
    let normalBuffer = gl.createBuffer(); 
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer); 
    gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW); 
    gl.vertexAttribPointer(gl.program.aNormal, 3, gl.FLOAT, false, 0, 0); 
    gl.enableVertexAttribArray(gl.program.aNormal); 

    // Load the color data onto the GPU
    let colorBuffer = gl.createBuffer(); 
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer); 
    gl.bufferData(gl.ARRAY_BUFFER, Float32Array.from(colors), gl.STATIC_DRAW); 
    gl.vertexAttribPointer(gl.program.aColor, 3, gl.FLOAT, false, 0, 0); 
    gl.enableVertexAttribArray(gl.program.aColor); 

    // Cleanup
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
}

/**
 * Start the flyer in the middle of the terrain (slightly above the middle elevation),
 * with the correct orientation, and in the correct spot according to the time of day.
 */
function setInitialPosition(terrain_data) {
    let middle_index = Math.floor(terrain_data.length / 2);
    let middle_value = terrain_data[middle_index][middle_index]; // middle y-value of terrain

    flyerPosition = [0, middle_value+0.3, 0];  // Sometimes still spawns flyer in or underneath the terrain
    rotation = [0, 0, 0];
    updatePosition([0, 0, 0]);
}

/**
 * Detects if the flyer will hit the terrain. If there is a collision, 
 * the direction vector's magnitude is lessened to a point right 
 * before the collision point. Returns the direction vector.
 */
function collision(directionVector) {
    for (let i = 0; i < gl.indices.length - 2; i++) { 
        let j = gl.indices[i]*3, k = gl.indices[i+1]*3, l = gl.indices[i+2]*3;   
        let A = gl.coords.subarray(j, j+3), B = gl.coords.subarray(k, k+3), C = gl.coords.subarray(l, l+3);  // The 3 points of the triangle
        let intersection = line_seg_triangle_intersection(vec3.negate(vec3.create(), flyerPosition), 
            vec3.negate(vec3.create(), directionVector), A, B, C);  // Determine if the flyer will collide with the terrain

        if (intersection) {
            let directionLength = vec3.distance(vec3.negate(vec3.create(), intersection), flyerPosition);  // distance between the intersection point and the flyer's position
            let factor = directionLength / vec3.length(directionVector) - 0.4;  // How much to decrease the direction vector's magnitude by
            directionVector = directionVector.map((value) => value * factor);   // Lessen direction vector's magnitude
        }
    }
    return directionVector;
}

/**
 * Make sure the flyer does not fly outside the edges of the terrain.
 */
function inBounds() {
    return -1 <= flyerPosition[0] && flyerPosition[0] <= 1 && -1 <= flyerPosition[2] && flyerPosition[2] <= 1;
}

/**
 * Updates the position of the flyer. Checks for collision with the terrain and makes 
 * sure that the flyer does not go out of bounds. Moves and rotates appropriately.
 */
function updatePosition(directionVector) {
    // Rotate direction vector
    vec3.rotateX(directionVector, directionVector, [0,0,0], -deg2rad(rotation[0]));
    vec3.rotateY(directionVector, directionVector, [0,0,0], -deg2rad(rotation[1]));
    vec3.rotateZ(directionVector, directionVector, [0,0,0], -deg2rad(rotation[2]));

    // Adds direction vector to current flyer position after checking for collision with terrain
    let vector = collision(directionVector);
    vec3.add(flyerPosition, flyerPosition, vector);
    if (!inBounds()) vec3.subtract(flyerPosition, flyerPosition, vector); // cannot fly out of bounds
    
    // Rotate point of view
    let position = mat4.fromXRotation(mat4.create(), deg2rad(rotation[0]));
    mat4.rotateZ(position, position, deg2rad(rotation[2]));
    mat4.rotateY(position, position, deg2rad(rotation[1]));

    // Translate flyer to correct position
    let destPosition = mat4.translate(mat4.create(), position, flyerPosition);

    // Update uniforms
    gl.uniformMatrix4fv(gl.program.uModelViewMatrix, false, destPosition);
    gl.uniformMatrix4fv(gl.program.uView, false, position); 
    updateProjectionMatrix();
}

/**
 * Gets the current time and updates the 
 * position of the light based on time of day.
 */
function updateLightPosition() {
    let hour = new Date().getHours();  // current hour of day
    let lightPos = [0, -10, 0, 1]; // initial light position (representing midnight or 0:00:00)
    vec3.rotateZ(lightPos, lightPos, [0,0,0], deg2rad(360 / 24 * hour));  // split up orbit into 24 evenly spaced locations
    gl.uniform4fv(gl.program.uLight, lightPos);
}

function render() {
    updateLightPosition(); // always check time of day to render light position correctly
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindVertexArray(gl.terrainVAO);
    gl.drawElements(gl.TRIANGLE_STRIP, gl.indices.length, gl.UNSIGNED_SHORT, 0); 
    gl.bindVertexArray(null);
    window.requestAnimationFrame(render);
}

/**
 * Keep the canvas sized to the window.
 */
function onWindowResize() {
    gl.canvas.width = window.innerWidth;
    gl.canvas.height = window.innerHeight;
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    updateProjectionMatrix();
}

/**
 * Event handler for when a key is pressed. Modifies direction 
 * vector or rotation depending on which key is pressed.
 */
function changePosition(e) {
    let directionVector = [0, 0, 0];

    if (e.key === 'ArrowUp') {
        directionVector[2] = 0.05;
    } else if (e.key === 'ArrowDown') {
        directionVector[2] = -0.05;
    } else if (e.key === 'ArrowLeft') {
        rotation[1] += -5;
    } else if (e.key === 'ArrowRight') {
        rotation[1] += 5;
    } else if (e.key === 'w') {
        rotation[0] += 5;
    } else if (e.key === 's') {
        rotation[0] += -5;
    } else if (e.key === 'a') {
        rotation[2] += -5;
    } else if (e.key === 'd') {
        rotation[2] += 5;
    }
    updatePosition(directionVector);
}

/**
 * Converts degrees to radians.
 */
function deg2rad(degrees) {
    return degrees * Math.PI / 180;
}

