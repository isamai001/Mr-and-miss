// Constants
const VOTE_PRICE = 20; // 20 KSH per vote
const ACCOUNT_NUMBER = 'EMBAKASI2023';
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const VALID_IMAGE_TYPES = ['image/jpeg', 'image/png'];
const VALID_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png'];
const PHONE_REGEX = /^254[17]\d{8}$/;

// App State
const state = {
    contestants: [],
    currentVoteContestant: null,
    currentVoteCount: 1,
    activeSharePopup: null,
    isLoading: true,
    votingEnabled: true,
    registrationFormData: {
        fullName: '',
        phone: '',
        email: '',
        category: '',
        bio: '',
        photoPreview: null
    }
};

// DOM Elements
const elements = {
    contestantsGrid: document.getElementById('contestantsGrid'),
    topTenContainer: document.querySelector('.top-ten-container'),
    loadingIndicator: document.getElementById('loadingIndicator'),
    currentTime: document.getElementById('currentTime'),
    searchInput: document.getElementById('searchInput'),
    searchButton: document.getElementById('searchButton'),
    registrationModal: document.getElementById('registrationModal'),
    paymentModal: document.getElementById('paymentModal'),
    registerBtn: document.getElementById('registerBtn'),
    closeRegisterModal: document.getElementById('closeRegisterModal'),
    closePaymentModal: document.getElementById('closePaymentModal'),
    registrationForm: document.getElementById('registrationForm'),
    photoUpload: document.getElementById('photoUpload'),
    uploadProgress: document.getElementById('uploadProgress'),
    progressBar: document.getElementById('progressBar'),
    uploadStatus: document.getElementById('uploadStatus'),
    paymentSteps: document.getElementById('paymentSteps')?.children || [],
    voteCountElement: document.getElementById('voteCount'),
    totalAmountElement: document.getElementById('totalAmount'),
    paymentAmountElement: document.getElementById('paymentAmount'),
    decrementVotesBtn: document.getElementById('decrementVotes'),
    incrementVotesBtn: document.getElementById('incrementVotes'),
    proceedToPaymentBtn: document.getElementById('proceedToPayment'),
    backToStep1Btn: document.getElementById('backToStep1'),
    processPaymentBtn: document.getElementById('processPayment'),
    closeAfterSuccessBtn: document.getElementById('closeAfterSuccess'),
    voteContestantPhoto: document.getElementById('voteContestantPhoto'),
    voteContestantName: document.getElementById('voteContestantName'),
    processingContestant: document.getElementById('processingContestant'),
    processingVotes: document.getElementById('processingVotes'),
    processingAmount: document.getElementById('processingAmount'),
    successContestant: document.getElementById('successContestant'),
    successVotes: document.getElementById('successVotes'),
    mpesaPhone: document.getElementById('mpesaPhone') || document.getElementById('mpesaPhoneInput'),
    votingDisabledMessage: document.getElementById('votingDisabledMessage'),
    candidateSelect: document.getElementById('candidateSelect'),
    photoPreview: document.getElementById('photoPreview'),
    registrationSteps: document.getElementById('registrationSteps')?.children || [],
    formErrors: document.getElementById('formErrors')
};

// Utility Functions
const utils = {
    debounce: (func, delay) => {
        let timeoutId;
        return (...args) => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => func.apply(this, args), delay);
        };
    },

    lazyLoadImages: () => {
        const lazyImages = document.querySelectorAll('.lazy-load');
        
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    img.src = img.dataset.src;
                    observer.unobserve(img);
                }
            });
        }, {
            rootMargin: '100px 0px',
            threshold: 0.01
        });
        
        lazyImages.forEach(img => observer.observe(img));
    },

    showToast: (message, type = 'success') => {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.classList.add('show');
            setTimeout(() => {
                toast.classList.remove('show');
                setTimeout(() => document.body.removeChild(toast), 300);
            }, 3000);
        }, 100);
    },

    validatePhone: (phone) => PHONE_REGEX.test(phone),
    
    validateEmail: (email) => {
        if (!email) return true; // Email is optional
        return /^[\w-.]+@([\w-]+\.)+[\w-]{2,4}$/.test(email);
    },
    
    getFileExtension: (filename) => {
        return filename.slice((filename.lastIndexOf(".") - 1 >>> 0) + 2).toLowerCase();
    }
};

// Core Functions
const core = {
    init: async () => {
        core.updateTime();
        setInterval(core.updateTime, 1000);
        
        core.loadFormData();
        await core.fetchVotingStatus();
        await core.loadContestants();
        core.setupEventListeners();
        core.updateVotingUI();
        
        document.addEventListener('click', (e) => {
            if (e.target === elements.registrationModal) {
                core.closeModal(elements.registrationModal);
            }
            if (e.target === elements.paymentModal) {
                core.closeModal(elements.paymentModal);
            }
            if (!e.target.closest('.share-btn') && !e.target.closest('.share-popup')) {
                core.closeSharePopup();
            }
        });
    },

    updateTime: () => {
        const now = new Date();
        const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (elements.currentTime) {
            elements.currentTime.textContent = timeString;
        }
    },

    loadFormData: () => {
        const savedData = localStorage.getItem('registrationFormData');
        if (savedData) {
            state.registrationFormData = JSON.parse(savedData);
            core.updateFormFields();
        }
    },

    saveFormData: () => {
        localStorage.setItem('registrationFormData', JSON.stringify(state.registrationFormData));
    },

    updateFormFields: () => {
        const form = elements.registrationForm;
        if (!form) return;
        
        const fields = ['fullName', 'phone', 'email', 'category', 'bio'];
        fields.forEach(field => {
            const input = form.querySelector(`[name="${field}"]`);
            if (input) {
                input.value = state.registrationFormData[field] || '';
            }
        });
        
        if (state.registrationFormData.photoPreview && elements.photoPreview) {
            elements.photoPreview.src = state.registrationFormData.photoPreview;
            elements.photoPreview.classList.remove('hidden');
        }
    },

    fetchVotingStatus: async () => {
        try {
            const response = await fetch('/api/config/voting-status');
            if (!response.ok) throw new Error('Failed to fetch voting status');
            const data = await response.json();
            state.votingEnabled = data.votingEnabled;
        } catch (error) {
            console.error('Error fetching voting status:', error);
            state.votingEnabled = false;
            utils.showToast('Error checking voting status. Voting may be disabled.', 'error');
        }
    },

    loadContestants: async () => {
        try {
            state.isLoading = true;
            if (elements.loadingIndicator) {
                elements.loadingIndicator.classList.remove('hidden');
            }
            
            const response = await fetch('/api/contestants');
            if (!response.ok) throw new Error('Failed to load contestants');
            
            state.contestants = await response.json();
            
            if (state.contestants.length === 0) {
                core.showNoContestantsMessage();
            } else {
                core.renderContestants();
                core.renderTopTen();
            }
        } catch (error) {
            console.error('Error loading contestants:', error);
            core.showNoContestantsMessage();
            utils.showToast('Error loading contestants. Please try again later.', 'error');
        } finally {
            state.isLoading = false;
            if (elements.loadingIndicator) {
                elements.loadingIndicator.classList.add('hidden');
            }
        }
    },

    showNoContestantsMessage: () => {
        if (!elements.contestantsGrid) return;
        
        elements.contestantsGrid.innerHTML = `
            <div class="col-span-full text-center py-8">
                <i class="fas fa-users text-4xl text-pink-500 mb-4"></i>
                <h3 class="text-xl font-bold text-gray-700">No contestants available yet</h3>
                <p class="text-gray-600 mt-2">Check back later or register to participate</p>
                <button id="registerNowBtn" class="mt-4 bg-pink-500 text-white px-4 py-2 rounded-lg hover:bg-pink-600 transition">
                    Register Now
                </button>
            </div>
        `;
        
        document.getElementById('registerNowBtn')?.addEventListener('click', () => {
            core.openModal(elements.registrationModal);
            core.showRegistrationStep(1);
        });
        
        if (elements.topTenContainer) {
            elements.topTenContainer.innerHTML = '';
        }
    },

    renderContestants: (filter = '') => {
        if (!elements.contestantsGrid) return;
        
        elements.contestantsGrid.innerHTML = '';
        
        const filteredContestants = state.contestants.filter(contestant => 
            (contestant.name.toLowerCase().includes(filter.toLowerCase()) || 
            contestant.category.toLowerCase().includes(filter.toLowerCase())) &&
            contestant.status === 'approved'
        );
        
        if (filteredContestants.length === 0) {
            elements.contestantsGrid.innerHTML = `
                <div class="col-span-full text-center py-8">
                    <i class="fas fa-search text-4xl text-pink-500 mb-4"></i>
                    <h3 class="text-xl font-bold text-gray-700">No contestants found</h3>
                    <p class="text-gray-600 mt-2">Try a different search term</p>
                </div>
            `;
            return;
        }
        
        filteredContestants.forEach(contestant => {
            const card = document.createElement('div');
            card.className = 'contestant-card will-change';
            card.innerHTML = `
                <div class="relative h-64 overflow-hidden rounded-t-lg">
                    <img data-src="${contestant.photo}" alt="${contestant.name}" 
                         class="w-full h-full object-cover lazy-load" 
                         loading="lazy">
                    <img src="images/mr-and-miss-embakasi-logo.png" 
                         alt="Mr & Miss Embakasi" 
                         class="absolute top-2 left-2 w-20 h-20 object-contain background-transparent">
                    
                    <button class="share-btn absolute top-2 right-2 bg-white bg-opacity-80 p-2 rounded-full" 
                            data-id="${contestant._id}">
                        <i class="fas fa-share-alt text-pink-500"></i>
                    </button>
                    
                    <div class="absolute bottom-2 left-2 right-2 flex justify-between items-center">
                        <div class="bg-black bg-opacity-50 text-white px-2 py-1 rounded text-sm">
                            ${contestant.category === 'mr' ? 'Mr. Embakasi' : 'Miss Embakasi'}
                        </div>
                        <div class="bg-black bg-opacity-50 text-white px-2 py-1 rounded text-sm">
                            <i class="fas fa-heart mr-1"></i> ${contestant.votes.toLocaleString()}
                        </div>
                    </div>
                </div>
                <div class="p-4 bg-white rounded-b-lg">
                    <h3 class="font-bold text-lg mb-2">${contestant.name}</h3>
                    <button class="vote-button w-full bg-pink-500 text-white py-2 rounded hover:bg-pink-600 transition" 
                            data-id="${contestant._id}" 
                            data-name="${contestant.name}" 
                            data-photo="${contestant.photo}"
                            ${!state.votingEnabled ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}>
                        <i class="fas fa-vote-yea mr-2"></i> Vote Now (${VOTE_PRICE} KSH)
                    </button>
                </div>
            `;
            
            elements.contestantsGrid.appendChild(card);
        });
        
        utils.lazyLoadImages();
    },

    renderTopTen: () => {
        if (!elements.topTenContainer) return;
        
        elements.topTenContainer.innerHTML = '';
        
        const topTen = [...state.contestants]
            .filter(c => c.status === 'approved')
            .sort((a, b) => b.votes - a.votes)
            .slice(0, 10);
        
        if (topTen.length === 0) return;
        
        const doubledTopTen = [...topTen, ...topTen];
        
        doubledTopTen.forEach((contestant, index) => {
            const item = document.createElement('div');
            item.className = 'top-ten-item flex items-center px-3 py-2 bg-white rounded-lg shadow-sm';
            item.innerHTML = `
                <div class="w-8 h-8 rounded-full overflow-hidden border-2 border-pink-500 flex-shrink-0">
                    <img src="${contestant.photo}" alt="${contestant.name}" 
                         class="w-full h-full object-cover" loading="lazy">
                </div>
                <div class="ml-2 flex items-center overflow-hidden">
                    <span class="font-bold text-pink-500 text-xs mr-1">#${(index % 10) + 1}</span>
                    <span class="font-medium text-xs truncate">${contestant.name}</span>
                    <span class="ml-2 text-xs bg-pink-100 px-1.5 py-0.5 rounded-full flex items-center flex-shrink-0">
                        <i class="fas fa-heart text-pink-500 mr-1 text-xs"></i> ${contestant.votes.toLocaleString()}
                    </span>
                </div>
            `;
            
            elements.topTenContainer.appendChild(item);
        });
    },

    updateVotingUI: () => {
        if (!state.votingEnabled && elements.votingDisabledMessage) {
            elements.votingDisabledMessage.classList.remove('hidden');
        } else if (elements.votingDisabledMessage) {
            elements.votingDisabledMessage.classList.add('hidden');
        }
        
        document.querySelectorAll('.vote-button').forEach(btn => {
            btn.disabled = !state.votingEnabled;
            btn.style.opacity = state.votingEnabled ? '1' : '0.5';
            btn.style.cursor = state.votingEnabled ? 'pointer' : 'not-allowed';
        });
    },

    setupEventListeners: () => {
        // Modal controls
        if (elements.registerBtn) {
            elements.registerBtn.addEventListener('click', () => {
                core.openModal(elements.registrationModal);
                core.showRegistrationStep(1);
            });
        }
        
        if (elements.closeRegisterModal) {
            elements.closeRegisterModal.addEventListener('click', () => {
                core.closeModal(elements.registrationModal);
                core.resetRegistrationForm();
            });
        }
        
        if (elements.closePaymentModal) {
            elements.closePaymentModal.addEventListener('click', () => {
                core.closeModal(elements.paymentModal);
                core.resetPaymentSteps();
            });
        }
        
        // Form handling
        if (elements.registrationForm) {
            elements.registrationForm.addEventListener('submit', core.handleRegistrationSubmit);
        }
        
        if (elements.photoUpload) {
            elements.photoUpload.addEventListener('change', core.handlePhotoUpload);
        }
        
        // Search functionality
        if (elements.searchInput) {
            elements.searchInput.addEventListener('input', utils.debounce(() => {
                core.renderContestants(elements.searchInput.value);
            }, 300));
        }
        
        if (elements.searchButton) {
            elements.searchButton.addEventListener('click', () => {
                core.renderContestants(elements.searchInput.value);
            });
        }
        
        // Contestant grid interactions
        if (elements.contestantsGrid) {
            elements.contestantsGrid.addEventListener('click', (e) => {
                if (e.target.closest('.vote-button') && state.votingEnabled) {
                    const button = e.target.closest('.vote-button');
                    core.handleVoteButtonClick(button);
                }
                if (e.target.closest('.share-btn')) {
                    const button = e.target.closest('.share-btn');
                    core.handleShareButtonClick(button);
                }
            });
        }
        
        // Voting controls
        if (elements.decrementVotesBtn) {
            elements.decrementVotesBtn.addEventListener('click', () => {
                if (state.currentVoteCount > 1) {
                    state.currentVoteCount--;
                    core.updateVoteCount();
                }
            });
        }
        
        if (elements.incrementVotesBtn) {
            elements.incrementVotesBtn.addEventListener('click', () => {
                if (state.currentVoteCount < 100) { // Limit to 100 votes at a time
                    state.currentVoteCount++;
                    core.updateVoteCount();
                } else {
                    utils.showToast('Maximum of 100 votes at a time', 'warning');
                }
            });
        }
        
        // Payment flow
        if (elements.proceedToPaymentBtn) {
            elements.proceedToPaymentBtn.addEventListener('click', () => {
                core.showPaymentStep(2);
            });
        }
        
        if (elements.backToStep1Btn) {
            elements.backToStep1Btn.addEventListener('click', () => {
                core.showPaymentStep(1);
            });
        }
        
        if (elements.processPaymentBtn) {
            elements.processPaymentBtn.addEventListener('click', core.handlePaymentSubmit);
        }
        
        if (elements.closeAfterSuccessBtn) {
            elements.closeAfterSuccessBtn.addEventListener('click', core.handlePaymentSuccessClose);
        }
        
        // Form validation
        if (elements.registrationForm) {
            elements.registrationForm.querySelectorAll('input, select, textarea').forEach(input => {
                input.addEventListener('input', core.handleFormInput);
                input.addEventListener('blur', core.handleFormInput);
            });
            
            // Phone number formatting
            const phoneInput = elements.registrationForm.querySelector('[name="phone"]');
            if (phoneInput) {
                phoneInput.addEventListener('input', core.formatPhoneNumber);
            }
        }
    },

    handleFormInput: (e) => {
        const input = e.target;
        state.registrationFormData[input.name] = input.value;
        core.saveFormData();
        core.validateField(input);
    },

    formatPhoneNumber: (e) => {
        let value = e.target.value.replace(/\D/g, '');
        if (value.startsWith('0')) {
            value = '254' + value.slice(1);
        } else if (!value.startsWith('254')) {
            value = '254' + value;
        }
        e.target.value = value;
        state.registrationFormData.phone = value;
        core.saveFormData();
        core.validateField(e.target);
    },

    validateField: (input) => {
        let error = '';
        
        switch (input.name) {
            case 'fullName':
                if (input.value.length < 3) {
                    error = 'Name must be at least 3 characters';
                } else if (input.value.length > 50) {
                    error = 'Name must be less than 50 characters';
                }
                break;
            case 'phone':
                if (!utils.validatePhone(input.value)) {
                    error = 'Enter a valid Kenyan phone number (254...)';
                }
                break;
            case 'email':
                if (!utils.validateEmail(input.value)) {
                    error = 'Enter a valid email address';
                }
                break;
            case 'category':
                if (!input.value) {
                    error = 'Please select a category';
                }
                break;
            case 'bio':
                if (input.value.length > 200) {
                    error = 'Bio must be less than 200 characters';
                }
                break;
        }
        
        const errorElement = input.nextElementSibling;
        if (errorElement && errorElement.classList.contains('error-message')) {
            errorElement.textContent = error;
            errorElement.style.display = error ? 'block' : 'none';
            input.classList.toggle('error', !!error);
        }
        
        core.updateFormErrors();
    },

    updateFormErrors: () => {
        if (!elements.formErrors) return;
        
        const errors = Array.from(elements.registrationForm?.querySelectorAll('.error-message') || [])
            .map(el => el.textContent)
            .filter(text => text);
        
        elements.formErrors.innerHTML = errors.length ? 
            `<div class="bg-red-50 border-l-4 border-red-500 p-4 mb-4">
                <div class="flex">
                    <div class="flex-shrink-0">
                        <i class="fas fa-exclamation-circle text-red-500"></i>
                    </div>
                    <div class="ml-3">
                        <h3 class="text-sm text-red-700">Please fix the following errors:</h3>
                        <ul class="list-disc text-sm text-red-700 mt-1 pl-5">${errors.map(e => `<li>${e}</li>`).join('')}</ul>
                    </div>
                </div>
            </div>` : '';
    },

    showRegistrationStep: (stepNumber) => {
        if (!elements.registrationSteps || elements.registrationSteps.length === 0) return;
        
        Array.from(elements.registrationSteps).forEach(step => step.classList.remove('active'));
        const stepElement = document.getElementById(`regStep${stepNumber}`);
        if (stepElement) {
            stepElement.classList.add('active');
        }
    },

    handleVoteButtonClick: (button) => {
        if (!state.votingEnabled) {
            utils.showToast('Voting is currently disabled by the administrator.', 'error');
            return;
        }
        
        state.currentVoteContestant = {
            id: button.dataset.id,
            name: button.dataset.name,
            photo: button.dataset.photo
        };
        
        if (elements.voteContestantPhoto) {
            elements.voteContestantPhoto.src = state.currentVoteContestant.photo;
        }
        
        if (elements.voteContestantName) {
            elements.voteContestantName.textContent = state.currentVoteContestant.name;
        }
        
        state.currentVoteCount = 1;
        core.updateVoteCount();
        
        core.openModal(elements.paymentModal);
    },

    handleShareButtonClick: (button) => {
        core.closeSharePopup();
        
        const contestantId = button.dataset.id;
        const contestant = state.contestants.find(c => c._id == contestantId);
        
        if (!contestant) return;
        
        const popup = document.createElement('div');
        popup.innerHTML = `
            <div class="share-popup bg-white rounded-lg shadow-lg p-3 absolute right-0 top-10 z-10 w-48">
                <div class="share-option facebook flex items-center p-2 hover:bg-gray-100 rounded cursor-pointer">
                    <i class="fab fa-facebook text-blue-600 mr-2"></i>
                    <span>Facebook</span>
                </div>
                <div class="share-option twitter flex items-center p-2 hover:bg-gray-100 rounded cursor-pointer">
                    <i class="fab fa-twitter text-blue-400 mr-2"></i>
                    <span>Twitter</span>
                </div>
                <div class="share-option whatsapp flex items-center p-2 hover:bg-gray-100 rounded cursor-pointer">
                    <i class="fab fa-whatsapp text-green-500 mr-2"></i>
                    <span>WhatsApp</span>
                </div>
                <div class="share-option link flex items-center p-2 hover:bg-gray-100 rounded cursor-pointer">
                    <i class="fas fa-link text-gray-500 mr-2"></i>
                    <span>Copy Link</span>
                </div>
            </div>
        `;
        
        const sharePopup = popup.firstElementChild;
        if (!sharePopup) return;
        
        button.parentNode.appendChild(sharePopup);
        sharePopup.classList.add('active');
        state.activeSharePopup = sharePopup;
        
        const shareOptions = sharePopup.querySelectorAll('.share-option');
        shareOptions.forEach(option => {
            option.addEventListener('click', () => {
                core.shareContestant(contestant, option.classList.contains('facebook') ? 'facebook' :
                                                  option.classList.contains('twitter') ? 'twitter' :
                                                  option.classList.contains('whatsapp') ? 'whatsapp' : 'link');
                core.closeSharePopup();
            });
        });
    },

    closeSharePopup: () => {
        if (state.activeSharePopup) {
            state.activeSharePopup.classList.remove('active');
            setTimeout(() => {
                if (state.activeSharePopup && state.activeSharePopup.parentNode) {
                    state.activeSharePopup.parentNode.removeChild(state.activeSharePopup);
                }
                state.activeSharePopup = null;
            }, 300);
        }
    },

    shareContestant: (contestant, platform = 'link') => {
        const shareUrl = `${window.location.origin}/contestant/${contestant._id}`;
        const shareText = `Vote for ${contestant.name} (${contestant.category === 'mr' ? 'Mr.' : 'Miss.'} Embakasi) in the Mr. & Miss Embakasi competition!`;
        
        switch (platform) {
            case 'facebook':
                window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}&quote=${encodeURIComponent(shareText)}`, '_blank');
                break;
            case 'twitter':
                window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`, '_blank');
                break;
            case 'whatsapp':
                window.open(`https://wa.me/?text=${encodeURIComponent(shareText + ' ' + shareUrl)}`, '_blank');
                break;
            case 'link':
                navigator.clipboard.writeText(`${shareText} ${shareUrl}`)
                    .then(() => utils.showToast('Link copied to clipboard!'))
                    .catch(() => {
                        const textArea = document.createElement('textarea');
                        textArea.value = `${shareText} ${shareUrl}`;
                        document.body.appendChild(textArea);
                        textArea.select();
                        document.execCommand('copy');
                        document.body.removeChild(textArea);
                        utils.showToast('Link copied to clipboard!');
                    });
                break;
        }
    },

    updateVoteCount: () => {
        if (elements.voteCountElement) {
            elements.voteCountElement.textContent = state.currentVoteCount;
        }
        
        const totalAmount = state.currentVoteCount * VOTE_PRICE;
        
        if (elements.totalAmountElement) {
            elements.totalAmountElement.textContent = `${totalAmount.toLocaleString()} KSH`;
        }
        
        if (elements.paymentAmountElement) {
            elements.paymentAmountElement.textContent = `${totalAmount.toLocaleString()} KSH`;
        }
    },

    showPaymentStep: (stepNumber) => {
        if (!elements.paymentSteps || elements.paymentSteps.length === 0) return;
        
        for (let i = 0; i < elements.paymentSteps.length; i++) {
            elements.paymentSteps[i].classList.remove('active');
        }
        
        const stepElement = document.getElementById(`step${stepNumber}`);
        if (stepElement) {
            stepElement.classList.add('active');
        }
        
        if (stepNumber === 3) {
            if (elements.processingContestant) {
                elements.processingContestant.textContent = state.currentVoteContestant.name;
            }
            if (elements.processingVotes) {
                elements.processingVotes.textContent = state.currentVoteCount;
            }
            if (elements.processingAmount) {
                elements.processingAmount.textContent = `${(state.currentVoteCount * VOTE_PRICE).toLocaleString()} KSH`;
            }
            
            setTimeout(() => {
                core.showPaymentStep(4);
                if (elements.successContestant) {
                    elements.successContestant.textContent = state.currentVoteContestant.name;
                }
                if (elements.successVotes) {
                    elements.successVotes.textContent = state.currentVoteCount;
                }
            }, 3000);
        }
    },

    resetPaymentSteps: () => {
        core.showPaymentStep(1);
        state.currentVoteCount = 1;
        core.updateVoteCount();
        if (elements.mpesaPhone) {
            elements.mpesaPhone.value = '';
        }
    },

    handleRegistrationSubmit: async (e) => {
        e.preventDefault();
        
        if (!elements.registrationForm) return;
        
        const formData = new FormData(elements.registrationForm);
        const file = elements.photoUpload?.files[0];
        
        // Validate all required fields
        const requiredFields = ['fullName', 'phone', 'category'];
        let hasError = false;
        
        requiredFields.forEach(field => {
            const input = elements.registrationForm.querySelector(`[name="${field}"]`);
            core.validateField(input);
            if (input?.nextElementSibling?.textContent) {
                hasError = true;
            }
        });
        
        if (!file) {
            core.showFormError('Please upload a photo');
            hasError = true;
        } else if (!VALID_IMAGE_TYPES.includes(file.type)) {
            core.showFormError('Please upload a JPEG or PNG image');
            hasError = true;
        } else if (!VALID_IMAGE_EXTENSIONS.includes('.' + utils.getFileExtension(file.name))) {
            core.showFormError('Invalid file extension. Please upload .jpg, .jpeg or .png');
            hasError = true;
        } else if (file.size > MAX_FILE_SIZE) {
            core.showFormError('File size must be less than 2MB');
            hasError = true;
        }
        
        if (hasError) {
            core.showRegistrationStep(1);
            return;
        }
        
        core.showRegistrationStep(2);
        if (elements.uploadProgress) {
            elements.uploadProgress.classList.remove('hidden');
        }
        if (elements.uploadStatus) {
            elements.uploadStatus.textContent = 'Uploading...';
        }
        if (elements.progressBar) {
            elements.progressBar.style.width = '0%';
        }
        
        // Create a unique filename
        const fileExtension = utils.getFileExtension(file.name);
        const timestamp = new Date().getTime();
        const randomString = Math.random().toString(36).substring(2, 8);
        const filename = `contestant_${timestamp}_${randomString}.${fileExtension}`;
        
        // Create FormData for file upload
        const uploadFormData = new FormData();
        uploadFormData.append('photo', file, filename);
        uploadFormData.append('contestantData', JSON.stringify({
            name: formData.get('fullName'),
            phone: formData.get('phone'),
            email: formData.get('email'),
            category: formData.get('category'),
            bio: formData.get('bio'),
            status: 'pending',
            votes: 0,
            registrationDate: new Date().toISOString()
        }));
        
        try {
            const response = await fetch('/api/contestants/register', {
                method: 'POST',
                body: uploadFormData
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Registration failed');
            }
            
            const result = await response.json();
            
            if (elements.uploadStatus) {
                elements.uploadStatus.textContent = 'Upload complete!';
            }
            if (elements.progressBar) {
                elements.progressBar.style.width = '100%';
            }
            
            core.showRegistrationStep(3);
            
            // Notify admin via email or other means
            await fetch('/api/admin/notify-new-registration', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contestantId: result.contestantId,
                    contestantName: formData.get('fullName'),
                    category: formData.get('category')
                })
            });
            
            setTimeout(() => {
                utils.showToast(`Thank you for registering, ${formData.get('fullName')}! Your application is under review.`);
                core.closeModal(elements.registrationModal);
                core.resetRegistrationForm();
            }, 1000);
            
        } catch (error) {
            console.error('Registration error:', error);
            core.showFormError('Error registering: ' + error.message);
            if (elements.uploadProgress) {
                elements.uploadProgress.classList.add('hidden');
            }
            core.showRegistrationStep(1);
        }
    },

    handlePhotoUpload: (e) => {
        const file = e.target.files[0];
        
        if (!file) {
            if (elements.photoPreview) {
                elements.photoPreview.classList.add('hidden');
            }
            return;
        }
        
        if (!VALID_IMAGE_TYPES.includes(file.type)) {
            core.showFormError('Please upload a JPEG or PNG image');
            if (elements.photoUpload) {
                elements.photoUpload.value = '';
            }
            return;
        }
        
        if (!VALID_IMAGE_EXTENSIONS.includes('.' + utils.getFileExtension(file.name))) {
            core.showFormError('Invalid file extension. Please upload .jpg, .jpeg or .png');
            if (elements.photoUpload) {
                elements.photoUpload.value = '';
            }
            return;
        }
        
        if (file.size > MAX_FILE_SIZE) {
            core.showFormError('File size must be less than 2MB');
            if (elements.photoUpload) {
                elements.photoUpload.value = '';
            }
            return;
        }
        
        const reader = new FileReader();
        reader.onload = function(event) {
            if (elements.photoPreview) {
                elements.photoPreview.src = event.target.result;
                elements.photoPreview.classList.remove('hidden');
                state.registrationFormData.photoPreview = event.target.result;
                core.saveFormData();
            }
            if (elements.uploadStatus) {
                elements.uploadStatus.textContent = `Selected: ${file.name}`;
            }
            if (elements.uploadProgress) {
                elements.uploadProgress.classList.remove('hidden');
            }
        };
        reader.readAsDataURL(file);
    },

    showFormError: (message) => {
        if (elements.formErrors) {
            elements.formErrors.innerHTML = `
                <div class="bg-red-50 border-l-4 border-red-500 p-4 mb-4">
                    <div class="flex">
                        <div class="flex-shrink-0">
                            <i class="fas fa-exclamation-circle text-red-500"></i>
                        </div>
                        <div class="ml-3">
                            <p class="text-sm text-red-700">${message}</p>
                        </div>
                    </div>
                </div>
            `;
        }
    },

    resetRegistrationForm: () => {
        if (elements.registrationForm) {
            elements.registrationForm.reset();
        }
        if (elements.uploadProgress) {
            elements.uploadProgress.classList.add('hidden');
        }
        if (elements.progressBar) {
            elements.progressBar.style.width = '0%';
        }
        if (elements.photoPreview) {
            elements.photoPreview.classList.add('hidden');
            elements.photoPreview.src = '';
        }
        if (elements.photoUpload) {
            elements.photoUpload.value = '';
        }
        
        state.registrationFormData = {
            fullName: '',
            phone: '',
            email: '',
            category: '',
            bio: '',
            photoPreview: null
        };
        
        localStorage.removeItem('registrationFormData');
        core.showRegistrationStep(1);
        core.updateFormErrors();
    },

    handlePaymentSubmit: async () => {
        try {
            if (!state.votingEnabled) {
                throw new Error('Voting is currently disabled by the administrator.');
            }
            
            const phone = elements.mpesaPhone?.value;
            
            if (!phone || !utils.validatePhone(phone)) {
                throw new Error('Please enter a valid Kenyan phone number starting with 254');
            }
            
            core.showPaymentStep(3);
            
            const voteTransaction = {
                contestantId: state.currentVoteContestant.id,
                contestantName: state.currentVoteContestant.name,
                votes: state.currentVoteCount,
                amount: state.currentVoteCount * VOTE_PRICE,
                phone: phone,
                timestamp: new Date().toISOString()
            };
            
            const response = await fetch('/api/votes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(voteTransaction)
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Payment processing failed');
            }
            
            const result = await response.json();
            
            if (result.success) {
                // Update local state
                const contestant = state.contestants.find(c => c._id == state.currentVoteContestant.id);
                if (contestant) {
                    contestant.votes += state.currentVoteCount;
                }
                
                core.renderTopTen();
            } else {
                throw new Error(result.message || 'Vote processing failed');
            }
            
        } catch (error) {
            console.error('Payment error:', error);
            utils.showToast(error.message, 'error');
            core.showPaymentStep(2);
        }
    },

    handlePaymentSuccessClose: async () => {
        core.closeModal(elements.paymentModal);
        core.resetPaymentSteps();
        
        try {
            await core.loadContestants();
            utils.showToast(`Success! ${state.currentVoteCount} votes added to ${state.currentVoteContestant.name}`);
        } catch (error) {
            console.error('Error refreshing contestants:', error);
            utils.showToast('Error updating contestant data', 'error');
        }
    },

    openModal: (modal) => {
        if (!modal) return;
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    },

    closeModal: (modal) => {
        if (!modal) return;
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
};

// Initialize the app
document.addEventListener('DOMContentLoaded', core.init);