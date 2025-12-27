// Client Portal JavaScript

const loginForm = document.getElementById('loginForm');
const loginScreen = document.getElementById('loginScreen');
const dashboardScreen = document.getElementById('dashboardScreen');
const logoutBtn = document.getElementById('logoutBtn');

// Handle login
if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        
        // In production, this would authenticate with your backend
        // For demo purposes, accept any credentials
        
        // Simulate loading
        const submitBtn = loginForm.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;
        submitBtn.textContent = 'Signing in...';
        submitBtn.disabled = true;
        
        setTimeout(() => {
            // Hide login, show dashboard
            loginScreen.style.display = 'none';
            dashboardScreen.style.display = 'flex';
            
            // Store session (in production, use proper auth tokens)
            sessionStorage.setItem('isLoggedIn', 'true');
            sessionStorage.setItem('userEmail', email);
        }, 1000);
    });
}

// Handle logout
if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        // Clear session
        sessionStorage.removeItem('isLoggedIn');
        sessionStorage.removeItem('userEmail');
        
        // Show login, hide dashboard
        loginScreen.style.display = 'flex';
        dashboardScreen.style.display = 'none';
        
        // Reset form
        if (loginForm) {
            loginForm.reset();
        }
    });
}

// Check if already logged in on page load
window.addEventListener('load', () => {
    const isLoggedIn = sessionStorage.getItem('isLoggedIn');
    
    if (isLoggedIn === 'true') {
        loginScreen.style.display = 'none';
        dashboardScreen.style.display = 'flex';
    }
});

// Tab switching for chart timeframes
const tabs = document.querySelectorAll('.tab');
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        // In production, this would load different chart data
        console.log('Loading chart data for:', tab.textContent);
    });
});

// Animate stat boxes on load
window.addEventListener('load', () => {
    const statBoxes = document.querySelectorAll('.stat-box');
    statBoxes.forEach((box, index) => {
        setTimeout(() => {
            box.style.opacity = '0';
            box.style.transform = 'translateY(20px)';
            box.style.transition = 'all 0.5s ease';
            
            setTimeout(() => {
                box.style.opacity = '1';
                box.style.transform = 'translateY(0)';
            }, 50);
        }, index * 100);
    });
});

// Add interactivity to nav items
const navItems = document.querySelectorAll('.nav-item');
navItems.forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        navItems.forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        
        // In production, this would load different views
        console.log('Navigating to:', item.textContent.trim());
    });
});

// Download PDF Report functionality
const downloadButtons = document.querySelectorAll('button');
downloadButtons.forEach(button => {
    if (button.textContent.includes('Download PDF')) {
        button.addEventListener('click', () => {
            // In production, this would generate and download a PDF
            alert('PDF report generation would happen here.\n\nIn production, this would connect to a backend service to generate a detailed portfolio report with charts, transaction history, and performance metrics.');
        });
    }
});

// Add real-time price updates simulation
function simulatePriceUpdates() {
    const btcValue = document.querySelector('.dashboard-stats .stat-box:nth-child(2) .stat-value');
    
    if (btcValue) {
        setInterval(() => {
            const currentBTC = parseFloat(btcValue.textContent.split(' ')[0]);
            const change = (Math.random() - 0.5) * 0.0001;
            const newBTC = (currentBTC + change).toFixed(4);
            btcValue.textContent = `${newBTC} BTC`;
        }, 5000);
    }
}

// Start simulations when dashboard is visible
const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.target.id === 'dashboardScreen' && 
            mutation.target.style.display !== 'none') {
            simulatePriceUpdates();
        }
    });
});

if (dashboardScreen) {
    observer.observe(dashboardScreen, { 
        attributes: true, 
        attributeFilter: ['style'] 
    });
}
