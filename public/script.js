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
const modelSelect = document.getElementById("modelSelect");
const systemPromptInput = document.getElementById("systemPromptInput");

let currentImageBase64 = null;
let currentConversationId = null;

const AI_AVATAR = `
<div class="avatar ai-avatar">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 0 1 10 10c0 5.523-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2z"></path><path d="M12 6v6l4 2"></path></svg>
</div>`;

const USER_AVATAR = `
<div class="avatar user-avatar">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
</div>`;

// --- UI HELPERS ---
function addMessage(text, role, imageSrc = null) {
    if(role === 'system') return; // Hide system prompts in UI
    
    const isUser = role === 'user';
    const msgDiv = document.createElement("div");
    msgDiv.className = `message ${isUser ? 'user-message' : 'ai-message'}`;
    
    let contentHtml = '';
    if (imageSrc && isUser) {
        // If image attached in user message
        contentHtml += `<img src="${imageSrc}" class="message-image" alt="Uploaded image" />`;
    }
    if (text) {
        // Filter out the [Uploaded an image] tag prefix for UI cleanliness if it exists
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

async function fetchConversations() {
    try {
        const res = await fetch("/api/conversations");
        const list = await res.json();
        renderSidebar(list);
        if(list.length > 0 && !currentConversationId) {
            loadConversation(list[0].id);
        } else if (list.length === 0) {
            createNewChat();
        }
    } catch(e) { console.error("Failed to load conversations", e); }
}

function renderSidebar(list) {
    convList.innerHTML = "";
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

async function loadConversation(id) {
    try {
        const res = await fetch(`/api/conversations/${id}`);
        const conv = await res.json();
        currentConversationId = id;
        headerTitle.textContent = conv.title;
        
        messagesContainer.innerHTML = "";
        conv.messages.forEach(msg => addMessage(msg.content, msg.role));
        
        // Update sidebar active state
        document.querySelectorAll('.conv-item').forEach(el => el.classList.remove('active'));
        // Re-fetch to update sidebar
        fetchConversations();
        
        if(window.innerWidth <= 768) toggleSidebar();
    } catch(e) { console.error(e); }
}

async function createNewChat(systemPromptOverride) {
    try {
        const res = await fetch("/api/conversations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                systemPrompt: systemPromptOverride || systemPromptInput.value
            })
        });
        const conv = await res.json();
        loadConversation(conv.id);
    } catch(e) { console.error(e); }
}

async function deleteConversation(id, event) {
    event.stopPropagation();
    try {
        await fetch(`/api/conversations/${id}`, { method: "DELETE" });
        if(currentConversationId === id) {
            currentConversationId = null;
            messagesContainer.innerHTML = "";
            headerTitle.textContent = "JK AI";
        }
        fetchConversations();
    } catch(e) { console.error(e); }
}

// --- SEND MESSAGE ---

async function sendMessage() {
    const userText = input.value.trim();
    const file = imageInput.files[0];

    if (!userText && !file) return;
    if (!currentConversationId) await createNewChat();

    addMessage(userText || "[Image attached]", 'user', currentImageBase64);
    input.value = "";
    
    const formData = new FormData();
    formData.append("message", userText);
    formData.append("conversationId", currentConversationId);
    formData.append("model", modelSelect.value);
    
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
            addMessage(data.reply, 'assistant');
            headerTitle.textContent = data.title;
            fetchConversations(); // update sidebar title if it changed
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

function toggleSidebar() {
    sidebar.classList.toggle('open');
}

function openSettings() {
    settingsModal.classList.add('active');
}
function closeSettings() {
    settingsModal.classList.remove('active');
}

function toggleTheme() {
    if(themeToggle.checked) {
        document.body.setAttribute('data-theme', 'light');
        themeLabel.textContent = "Light Mode";
    } else {
        document.body.setAttribute('data-theme', 'dark');
        themeLabel.textContent = "Dark Mode";
    }
}

function applySettings() {
    closeSettings();
    createNewChat(systemPromptInput.value);
}

async function exportConversation() {
    if(!currentConversationId) return alert("No active conversation to export.");
    try {
        const res = await fetch(`/api/conversations/${currentConversationId}`);
        const conv = await res.json();
        
        let transcript = `Conversation: ${conv.title}\nDate: ${new Date(conv.createdAt).toLocaleString()}\n\n`;
        conv.messages.forEach(msg => {
            if(msg.role === 'system') return;
            transcript += `[${msg.role.toUpperCase()}]: ${msg.content}\n\n`;
        });
        
        const blob = new Blob([transcript], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${conv.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_export.txt`;
        a.click();
    } catch(e) { console.error("Export failed", e); }
}

// Init
fetchConversations();