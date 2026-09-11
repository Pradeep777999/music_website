/* Nexonic Theme Handler - Light & Dark Mode Persistence */

document.addEventListener('DOMContentLoaded', () => {
    const headerToggle = document.getElementById('header-theme-toggle');
    const landingToggle = document.getElementById('landing-theme-toggle');
    const settingsToggle = document.getElementById('dark-mode-toggle');

    // Function to apply theme changes to DOM and persistent storage
    function applyTheme(isLight) {
        if (isLight) {
            document.documentElement.classList.add('light-theme');
            localStorage.setItem('theme', 'light');
        } else {
            document.documentElement.classList.remove('light-theme');
            localStorage.setItem('theme', 'dark');
        }
        updateUI();
    }

    // Function to update all theme-related toggles on the page
    function updateUI() {
        const isLight = document.documentElement.classList.contains('light-theme');

        // Update Header and Landing Toggle Icons
        const toggleButtons = [headerToggle, landingToggle];
        toggleButtons.forEach(btn => {
            if (btn) {
                const icon = btn.querySelector('i');
                if (icon) {
                    if (isLight) {
                        icon.className = 'fas fa-sun';
                        btn.title = 'Switch to Dark Mode';
                    } else {
                        icon.className = 'fas fa-moon';
                        btn.title = 'Switch to Light Mode';
                    }
                }
            }
        });

        // Update Settings Checkbox Status (Checked = Dark Mode, Unchecked = Light Mode)
        if (settingsToggle) {
            settingsToggle.checked = !isLight;
            // Enable the switch if it was disabled
            settingsToggle.removeAttribute('disabled');
        }
    }

    // Setup Event Listeners
    if (headerToggle) {
        headerToggle.addEventListener('click', (e) => {
            e.preventDefault();
            const isCurrentlyLight = document.documentElement.classList.contains('light-theme');
            applyTheme(!isCurrentlyLight);
        });
    }

    if (landingToggle) {
        landingToggle.addEventListener('click', (e) => {
            e.preventDefault();
            const isCurrentlyLight = document.documentElement.classList.contains('light-theme');
            applyTheme(!isCurrentlyLight);
        });
    }

    if (settingsToggle) {
        // Remove disabled attribute in case it was rendered disabled
        settingsToggle.removeAttribute('disabled');
        settingsToggle.addEventListener('change', () => {
            applyTheme(!settingsToggle.checked);
        });
    }

    // Initial sync of UI state on load
    updateUI();
});
