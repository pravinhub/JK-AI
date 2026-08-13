const input = document.getElementById("input");
const imageInput = document.getElementById("imageInput");
const messagesContainer = document.getElementById("messages");
const uploadBtn = document.getElementById("uploadBtn");
const sendBtn = document.getElementById("sendBtn");
const imagePreviewContainer = document.getElementById("imagePreviewContainer");
const imagePreview = document.getElementById("imagePreview");
const removeImageBtn = document.getElementById("removeImageBtn");

// Sidebar & Settings Elements
const sidebar = document.getElementById("sidebar");
const convList = document.getElementById("convList");
const headerTitle = document.getElementById("headerTitle");
const settingsModal = document.getElementById("settingsModal");
const themeToggle = document.getElementById("themeToggle");
const themeLabel = document.getElementById("themeLabel");
const defaultModelSelect = document.getElementById("defaultModelSelect");
const chatModelSelect = document.getElementById("chatModelSelect");
const systemPromptInput = document.getElementById("systemPromptInput");

let currentImageBase64 = null;

// --- STATE MANAGEMENT ---
let conversations = JSON.parse(localStorage.getItem("jk_ai_conversations") || "{}");
let currentConversationId = localStorage.getItem("jk_ai_current_conversation") || null;

const AI_AVATAR = `
<div class="avatar ai-avatar">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 0 1 10 10c0 5.523-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2z"></path><path d="M12 6v6l4 2"></path></svg>
</div>`;

const USER_AVATAR = `
<div class="avatar user-avatar">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
</div>`;

function saveState() {
    localStorage.setItem("jk_ai_conversations", JSON.stringify(conversations));
    if (currentConversationId) {
        localStorage.setItem("jk_ai_current_conversation", currentConversationId);
    } else {
        localStorage.removeItem("jk_ai_current_conversation");
    }
}

function generateId() {
    return 'chat_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
}

// --- UI HELPERS ---
function addMessage(text, role, imageSrc = null) {
    if(role === 'system') return; // Hide system prompts in UI
    
    const isUser = role === 'user';
    const msgDiv = document.createElement("div");
    msgDiv.className = `message ${isUser ? 'user-message' : 'ai-message'}`;
    
    let contentHtml = '';
    if (imageSrc && isUser) {
        contentHtml += `<img src="${imageSrc}" class="message-image" alt="Uploaded image" />`;
    }
    if (text) {
        let cleanText = text;
        if(text.includes("[Uploaded an image]")) {
            cleanText = text.replace(/\[Uploaded an image\]\nQuestion:\s*/, "");
        }
        const safeText = cleanText.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        contentHtml += safeText;
    }

    msgDiv.innerHTML = `
        ${isUser ? USER_AVATAR : AI_AVATAR}
        <div class="message-content">${contentHtml}</div>
    `;
    
    messagesContainer.appendChild(msgDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function showTyping() {
    const msgDiv = document.createElement("div");
    msgDiv.className = "message ai-message";
    msgDiv.id = "typingIndicator";
    msgDiv.innerHTML = `
        ${AI_AVATAR}
        <div class="message-content">
            <div class="typing-indicator">
                <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
            </div>
        </div>
    `;
    messagesContainer.appendChild(msgDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function removeTyping() {
    const typingIndicator = document.getElementById("typingIndicator");
    if (typingIndicator) typingIndicator.remove();
}

function clearImagePreview() {
    imageInput.value = "";
    currentImageBase64 = null;
    imagePreviewContainer.classList.add("hidden");
    imagePreview.src = "";
    uploadBtn.style.color = "var(--text-secondary)";
}

// --- CONVERSATION MANAGEMENT ---
function initApp() {
    // Load theme
    const savedTheme = localStorage.getItem("jk_ai_theme") || "dark";
    if (savedTheme === "light") {
        themeToggle.checked = true;
        document.body.setAttribute('data-theme', 'light');
        themeLabel.textContent = "Light Mode";
    }

    // Load default model
    const defaultModel = localStorage.getItem("jk_ai_default_model") || "llama-3.3-70b-versatile";
    defaultModelSelect.value = defaultModel;

    renderSidebar();
    
    if (currentConversationId && conversations[currentConversationId]) {
        loadConversation(currentConversationId);
    } else {
        const keys = Object.keys(conversations);
        if (keys.length > 0) {
            loadConversation(keys[0]);
        } else {
            createNewChat();
        }
    }
}

function renderSidebar() {
    convList.innerHTML = "";
    const list = Object.values(conversations).sort((a, b) => b.createdAt - a.createdAt);
    
    list.forEach(conv => {
        const div = document.createElement("div");
        div.className = `conv-item ${conv.id === currentConversationId ? 'active' : ''}`;
        div.onclick = () => loadConversation(conv.id);
        
        div.innerHTML = `
            <span class="conv-title">${conv.title}</span>
            <button class="delete-conv-btn" onclick="deleteConversation('${conv.id}', event)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
        `;
        convList.appendChild(div);
    });
}

function loadConversation(id) {
    if (!conversations[id]) return;
    currentConversationId = id;
    const conv = conversations[id];
    
    headerTitle.textContent = conv.title;
    chatModelSelect.value = conv.model;
    
    messagesContainer.innerHTML = "";
    conv.messages.forEach(msg => {
        // Simple extraction hack for image base64 if we want to show it in UI 
        // (normally you'd save it separately, but for brevity we'll just let UI render text)
        addMessage(msg.content, msg.role, msg.imageSrc); 
    });
    
    saveState();
    renderSidebar();
    
    if(window.innerWidth <= 768) sidebar.classList.remove('open');
}

function createNewChat(systemPromptOverride) {
    const defaultModel = localStorage.getItem("jk_ai_default_model") || "llama-3.3-70b-versatile";
    const prompt = systemPromptOverride || systemPromptInput.value || "You are JK AI, a smart multimodal AI assistant. Be conversational, helpful, and concise.";
    
    const id = generateId();
    conversations[id] = {
        id: id,
        title: "New Conversation",
        createdAt: Date.now(),
        model: defaultModel,
        messages: [
            { role: "system", content: prompt }
        ]
    };
    
    currentConversationId = id;
    saveState();
    loadConversation(id);
}

function deleteConversation(id, event) {
    event.stopPropagation();
    delete conversations[id];
    
    if(currentConversationId === id) {
        currentConversationId = null;
        messagesContainer.innerHTML = "";
        headerTitle.textContent = "JK AI";
    }
    saveState();
    
    const keys = Object.keys(conversations);
    if(keys.length > 0 && !currentConversationId) {
        loadConversation(keys[0]);
    } else if (keys.length === 0) {
        createNewChat();
    } else {
        renderSidebar();
    }
}

// Update the model for the current chat when header dropdown changes
function updateChatModel() {
    if (currentConversationId && conversations[currentConversationId]) {
        conversations[currentConversationId].model = chatModelSelect.value;
        saveState();
    }
}

// --- SEND MESSAGE ---
async function sendMessage() {
    const userText = input.value.trim();
    const file = imageInput.files[0];

    if (!userText && !file) return;
    if (!currentConversationId || !conversations[currentConversationId]) {
        createNewChat();
    }

    const conv = conversations[currentConversationId];

    // Build the payload message
    let payloadText = userText;
    if (file && userText) {
        payloadText = `[Uploaded an image]\nQuestion: ${userText}`;
    } else if (file) {
        payloadText = `[Uploaded an image]`;
    }

    // Save to local state
    const userMessage = { role: 'user', content: payloadText, imageSrc: currentImageBase64 };
    conv.messages.push(userMessage);

    // If it's a new conversation, update title
    if (conv.title === "New Conversation" && userText) {
        conv.title = userText.substring(0, 30) + (userText.length > 30 ? "..." : "");
    }
    
    saveState();
    renderSidebar();

    addMessage(userText || "[Image attached]", 'user', currentImageBase64);
    input.value = "";
    
    const formData = new FormData();
    formData.append("messages", JSON.stringify(conv.messages));
    formData.append("model", conv.model);
    
    if (file) formData.append("image", file);

    clearImagePreview();
    showTyping();
    sendBtn.disabled = true;

    try {
        const response = await fetch("/chat", {
            method: "POST",
            body: formData,
        });
        
        const data = await response.json();
        removeTyping();
        
        if (data.reply) {
            conv.messages.push({ role: "assistant", content: data.reply });
            
            // Limit memory array size to 30 to prevent payload too large
            if (conv.messages.length > 30) {
                conv.messages = [conv.messages[0], ...conv.messages.slice(-29)];
            }
            saveState();

            addMessage(data.reply, 'assistant');
        } else if (data.error) {
            addMessage(`Error: ${data.error}`, 'assistant');
        }

    } catch (error) {
        console.error(error);
        removeTyping();
        addMessage("Error: Failed to connect to server.", 'assistant');
    } finally {
        sendBtn.disabled = false;
        input.focus();
    }
}

// --- EVENT LISTENERS ---
input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        event.preventDefault();
        sendMessage();
    }
});

uploadBtn.addEventListener("click", () => imageInput.click());
removeImageBtn.addEventListener("click", clearImagePreview);

imageInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            currentImageBase64 = e.target.result;
            imagePreview.src = currentImageBase64;
            imagePreviewContainer.classList.remove("hidden");
            uploadBtn.style.color = "var(--accent-glow)";
        }
        reader.readAsDataURL(file);
    } else {
        clearImagePreview();
    }
});

// --- SETTINGS & SIDEBAR ---
function toggleSidebar() { sidebar.classList.toggle('open'); }
function openSettings() { settingsModal.classList.add('active'); }
function closeSettings() { settingsModal.classList.remove('active'); }

function toggleTheme() {
    if(themeToggle.checked) {
        document.body.setAttribute('data-theme', 'light');
        themeLabel.textContent = "Light Mode";
        localStorage.setItem("jk_ai_theme", "light");
    } else {
        document.body.setAttribute('data-theme', 'dark');
        themeLabel.textContent = "Dark Mode";
        localStorage.setItem("jk_ai_theme", "dark");
    }
}

function updateDefaultModel() {
    localStorage.setItem("jk_ai_default_model", defaultModelSelect.value);
}

function applySettings() {
    updateDefaultModel();
    closeSettings();
    createNewChat(systemPromptInput.value);
}

function exportConversation() {
    if(!currentConversationId || !conversations[currentConversationId]) return alert("No active conversation to export.");
    const conv = conversations[currentConversationId];
    
    let transcript = `Conversation: ${conv.title}\nDate: ${new Date(conv.createdAt).toLocaleString()}\nModel: ${conv.model}\n\n`;
    conv.messages.forEach(msg => {
        if(msg.role === 'system') return;
        transcript += `[${msg.role.toUpperCase()}]: ${msg.content}\n\n`;
    });
    
    const blob = new Blob([transcript], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${conv.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_export.txt`;
    a.click();
}

function clearAllData() {
    if(confirm("Are you sure you want to delete all local conversation history and settings? This cannot be undone.")) {
        localStorage.clear();
        conversations = {};
        currentConversationId = null;
        window.location.reload();
    }
}

// Init
initApp();