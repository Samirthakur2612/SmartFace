document.addEventListener('DOMContentLoaded', () => {

    const canvas = document.createElement('canvas');
    canvas.id = 'particleCanvas';
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.zIndex = '0';
    canvas.style.pointerEvents = 'none'; // Allow clicks to pass through
    document.body.insertBefore(canvas, document.body.firstChild);

    const ctx = canvas.getContext('2d');
    let width, height;
    let particles = [];
    
    // Mouse tracking
    let mouse = { x: -1000, y: -1000, radius: 180 };

    window.addEventListener('mousemove', function(event) {
        mouse.x = event.clientX;
        mouse.y = event.clientY;
    });

    window.addEventListener('mouseout', function() {
        mouse.x = -1000;
        mouse.y = -1000;
    });

    window.addEventListener('resize', resizeCanvas);

    function resizeCanvas() {
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = width;
        canvas.height = height;
        initParticles();
    }

    class Particle {
        constructor() {
            this.x = Math.random() * width;
            this.y = Math.random() * height;
            // The image has small glowing dots
            this.size = Math.random() * 2 + 1.5;
            this.speedX = Math.random() * 1.5 - 0.75;
            this.speedY = Math.random() * 1.5 - 0.75;
            // Teal/cyan glowing color for particles
            const opac = Math.random() * 0.5 + 0.5;
            this.color = `rgba(168, 237, 245, ${opac})`;
        }
        
        update() {
            this.x += this.speedX;
            this.y += this.speedY;

            // Bounce off boundaries
            if (this.x > width + 50 || this.x < -50) this.speedX = -this.speedX;
            if (this.y > height + 50 || this.y < -50) this.speedY = -this.speedY;
        }

        draw() {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fillStyle = this.color;
            ctx.shadowBlur = 10;
            ctx.shadowColor = 'rgba(168, 237, 245, 0.8)';
            ctx.fill();
            ctx.shadowBlur = 0; // reset for lines
        }
    }

    function initParticles() {
        particles = [];
        // Adjust density
        let numberOfParticles = (width * height) / 12000;
        for (let i = 0; i < numberOfParticles; i++) {
            particles.push(new Particle());
        }
    }

    function connectParticles() {
        for (let a = 0; a < particles.length; a++) {
            for (let b = a + 1; b < particles.length; b++) {
                let dx = particles[a].x - particles[b].x;
                let dy = particles[a].y - particles[b].y;
                let distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < 130) {
                    let opacityValue = 1 - (distance / 130);
                    // Light cyan lines
                    ctx.strokeStyle = `rgba(168, 237, 245, ${opacityValue * 0.3})`;
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(particles[a].x, particles[a].y);
                    ctx.lineTo(particles[b].x, particles[b].y);
                    ctx.stroke();
                }
            }
            
            // Connect to mouse with stronger glow
            if (mouse.x !== -1000 && mouse.y !== -1000) {
                let dx = particles[a].x - mouse.x;
                let dy = particles[a].y - mouse.y;
                let distance = Math.sqrt(dx * dx + dy * dy);
                if (distance < mouse.radius) {
                    let opacityValue = 1 - (distance / mouse.radius);
                    ctx.strokeStyle = `rgba(168, 237, 245, ${opacityValue * 0.8})`; // brighter line
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.moveTo(particles[a].x, particles[a].y);
                    ctx.lineTo(mouse.x, mouse.y);
                    ctx.stroke();
                    
                    // Add a tiny bit of attraction to mouse
                    particles[a].x -= dx * 0.005;
                    particles[a].y -= dy * 0.005;
                }
            }
        }
    }

    function animate() {
        requestAnimationFrame(animate);
        ctx.clearRect(0, 0, width, height);

        for (let i = 0; i < particles.length; i++) {
            particles[i].update();
            particles[i].draw();
        }
        connectParticles();
    }

    resizeCanvas();
    animate();
});
