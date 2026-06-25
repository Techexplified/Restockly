(function () {
  const Restockly = window.Restockly || {};
  const product = Restockly.product;
  const shop = Restockly.shop;
  const appUrl = "/apps/restockly-api";
  
  // These are loaded from app settings API via loadSettings() below
  let lowStockThreshold = 12;
  let lowStockTextTemplate = "Only {quantity} units remaining";
  let buttonText = "Notify Me When Available";
  let confirmMsg = "You're on the list!";

  if (!product) return;

  let currentVariantId = null;
  let activeVariant = null;
  let publicVapidKey = null;

  // Fetch settings dynamically from the app database
  async function loadSettings() {
    try {
      const response = await fetch(`${appUrl}/api/settings?shop=${shop}&t=${Date.now()}`);
      const settings = await response.json();
      if (settings && !settings.error) {
        if (settings.buttonText) buttonText = settings.buttonText;
        if (settings.confirmMsg) confirmMsg = settings.confirmMsg;
        if (settings.lowStockThreshold !== undefined) lowStockThreshold = settings.lowStockThreshold;
        if (settings.lowStockText) lowStockTextTemplate = settings.lowStockText;
        if (settings.publicVapidKey) publicVapidKey = settings.publicVapidKey;

        // Apply custom button text to elements if they are present in DOM
        if (notifyBtn) {
          const btnTextEl = notifyBtn.querySelector(".restockly-btn-text");
          if (btnTextEl) btnTextEl.textContent = buttonText;
        }
      }
    } catch (err) {
      console.warn("Failed to load Restockly settings:", err);
    }
  }

  // DOM Elements
  const lowStockBanner = document.getElementById("restockly-low-stock-banner");
  const lowStockText = document.getElementById("restockly-low-stock-text");
  const outOfStockBadge = document.getElementById("restockly-out-of-stock-badge");
  const notifyBtn = document.getElementById("restockly-notify-btn");
  const subscribedCard = document.getElementById("restockly-subscribed-card");
  const subscribedMsg = document.getElementById("restockly-subscribed-msg");
  const subscribedCount = document.getElementById("restockly-subscribed-count");
  
  const modal = document.getElementById("restockly-modal");
  const modalClose = document.getElementById("restockly-modal-close");
  const successCloseBtn = document.getElementById("restockly-success-close-btn");
  
  const formStep = document.getElementById("restockly-form-step");
  const successStep = document.getElementById("restockly-success-step");
  const subscribeForm = document.getElementById("restockly-subscribe-form");
  
  const modalVariantTitle = document.getElementById("restockly-modal-variant-title");
  const modalVariantPrice = document.getElementById("restockly-modal-variant-price");
  const modalVariantImg = document.getElementById("restockly-modal-variant-img");
  
  const checkboxPush = document.getElementById("restockly-channel-push");

  // Relocate the wrapper to the target location inside the product form/above the buy button
  function injectWidgetWrapper() {
    const widgetWrapper = document.querySelector(".restockly-widget-wrapper");
    if (!widgetWrapper) return;

    // 1. Try to find Dawn's product-form__buttons container
    let target = document.querySelector('form[action*="/cart/add"] .product-form__buttons');
    if (target) {
      target.insertBefore(widgetWrapper, target.firstChild);
      return;
    }

    // 2. Try to find the Add to Cart submit button
    target = document.querySelector('form[action*="/cart/add"] button[type="submit"], form[action*="/cart/add"] input[type="submit"]');
    if (target) {
      target.parentNode.insertBefore(widgetWrapper, target);
      return;
    }

    // 3. Fallback to standard product form
    target = document.querySelector('form[action*="/cart/add"]');
    if (target) {
      target.appendChild(widgetWrapper);
    }
  }

  // Helper to get selected variant ID from DOM or URL
  function getSelectedVariantId() {
    // 1. Check URL
    const urlParams = new URLSearchParams(window.location.search);
    let variantId = urlParams.get("variant");
    if (variantId) return parseInt(variantId, 10);

    // 2. Check form input name="id"
    const idInput = document.querySelector('form[action*="/cart/add"] select[name="id"], form[action*="/cart/add"] input[name="id"]');
    if (idInput && idInput.value) {
      return parseInt(idInput.value, 10);
    }

    // 3. Fallback to first variant
    if (product.variants && product.variants.length > 0) {
      return product.variants[0].id;
    }
    return null;
  }

  // Update layout according to variant stock
  function updateWidgetLayout(variantId) {
    if (!variantId) return;
    
    activeVariant = product.variants.find(v => v.id === variantId);
    if (!activeVariant) return;

    // Find native buy buttons (Add to Cart, Buy It Now) to toggle
    const nativeAddToCartBtn = document.querySelector('form[action*="/cart/add"] button[type="submit"], form[action*="/cart/add"] input[type="submit"]');
    const dynamicCheckoutBtn = document.querySelector('form[action*="/cart/add"] .shopify-payment-button');

    const quantity = (window.Restockly && window.Restockly.variantInventory && window.Restockly.variantInventory[variantId] !== undefined)
      ? window.Restockly.variantInventory[variantId]
      : activeVariant.inventory_quantity;
    const isAvailable = activeVariant.available;

    // Reset layouts
    if (lowStockBanner) lowStockBanner.style.display = "none";
    if (outOfStockBadge) outOfStockBadge.style.display = "none";
    if (notifyBtn) notifyBtn.style.display = "none";
    if (subscribedCard) subscribedCard.style.display = "none";

    // Check if customer already subscribed to this variant in localStorage
    const savedState = localStorage.getItem("restockly-subscribed-" + variantId);

    if (!isAvailable) {
      // 1. OUT OF STOCK STATE
      if (outOfStockBadge) outOfStockBadge.style.display = "block";

      // Hide native add to cart and dynamic checkout buttons
      if (nativeAddToCartBtn) nativeAddToCartBtn.style.display = "none";
      if (dynamicCheckoutBtn) dynamicCheckoutBtn.style.display = "none";

      if (savedState) {
        // Show inline success card instead of Notify button
        const data = JSON.parse(savedState);
        if (subscribedCard) {
          const titleEl = subscribedCard.querySelector(".restockly-subscribed-title");
          if (titleEl && confirmMsg) {
            titleEl.textContent = confirmMsg;
          }
        }
        if (subscribedMsg) {
          if (data.email) {
            subscribedMsg.textContent = `We'll email you at ${data.email} when this is back in stock.`;
          } else {
            subscribedMsg.textContent = "We'll send push notifications when this is back in stock.";
          }
        }
        if (subscribedCount) {
          const othersCount = Math.max(0, (data.count || 1) - 1);
          subscribedCount.textContent = `${othersCount} others are also waiting for this item.`;
        }
        if (subscribedCard) subscribedCard.style.display = "flex";
      } else {
        // Show Notify button
        if (notifyBtn) notifyBtn.style.display = "block";
      }
    } else {
      // Restore native buy buttons
      if (nativeAddToCartBtn) nativeAddToCartBtn.style.display = "";
      if (dynamicCheckoutBtn) dynamicCheckoutBtn.style.display = "";

      if (quantity > 0 && quantity <= lowStockThreshold) {
        // 2. LOW STOCK STATE
        if (lowStockBanner) lowStockBanner.style.display = "block";
        if (lowStockText) {
          lowStockText.textContent = lowStockTextTemplate.replace("{quantity}", quantity);
        }
      } else {
        // 3. IN STOCK (NORMAL) STATE
        // Keep banners hidden
      }
    }
  }

  // Poll for variant changes (extremely robust across themes)
  function startVariantPolling() {
    setInterval(() => {
      const selectedId = getSelectedVariantId();
      if (selectedId !== currentVariantId) {
        currentVariantId = selectedId;
        updateWidgetLayout(selectedId);
      }
    }, 250);
  }


  // Modal Open
  if (notifyBtn) {
    notifyBtn.addEventListener("click", function () {
      if (!activeVariant) return;

      // Set modal variant details
      if (modalVariantTitle) {
        modalVariantTitle.textContent = `${product.title} — ${activeVariant.title}`;
      }
      if (modalVariantPrice) {
        modalVariantPrice.textContent = (activeVariant.price / 100).toLocaleString(undefined, { style: "currency", currency: product.currency || "USD" });
      }
      
      // Find image
      const variantImage = activeVariant.featured_image || product.featured_image;
      if (variantImage && modalVariantImg) {
        modalVariantImg.textContent = "";
        const img = document.createElement("img");
        img.src = variantImage.src || variantImage;
        img.alt = activeVariant.title;
        img.style.width = "48px";
        img.style.height = "48px";
        img.style.borderRadius = "6px";
        img.style.objectFit = "cover";
        modalVariantImg.appendChild(img);
      } else if (modalVariantImg) {
        modalVariantImg.textContent = "🧥";
      }

      // Reset steps
      if (formStep) formStep.style.display = "block";
      if (successStep) successStep.style.display = "none";
      
      // Show Modal
      if (modal) modal.style.display = "flex";
    });
  }

  // Modal Close
  function closeModal() {
    if (modal) modal.style.display = "none";
  }

  if (modalClose) modalClose.addEventListener("click", closeModal);
  if (successCloseBtn) successCloseBtn.addEventListener("click", closeModal);
  if (modal) {
    modal.addEventListener("click", function (e) {
      if (e.target === modal) closeModal();
    });
  }

  // Register Service Worker from App Proxy
  async function ensureServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        const swUrl = `${appUrl}/sw.js`;
        const registration = await navigator.serviceWorker.register(swUrl, { scope: `${appUrl}/` });
        console.log("Restockly Service Worker registered:", registration);
        return registration;
      } catch (err) {
        console.warn("Restockly Service Worker registration failed:", err);
      }
    }
    return null;
  }

  // Handle Form Submission
  if (subscribeForm) {
    subscribeForm.addEventListener("submit", async function (e) {
      e.preventDefault();

      // Always subscribe via push
      const channels = ["push"];

      const submitBtn = document.getElementById("restockly-submit-btn");
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Saving...";
      }

      // Get Push Subscription
      let pushSubscription = null;
      try {
        const permission = await Notification.requestPermission();
        if (permission === "granted" && "serviceWorker" in navigator) {
          const registration = await ensureServiceWorker();
          if (registration && publicVapidKey) {
            pushSubscription = await registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlB64ToUint8Array(publicVapidKey)
            });
          }
        }
      } catch (err) {
        console.warn("Failed to subscribe to Web Push:", err);
      }

      // Send subscription request
      let successCount = 0;
      let totalCount = 142;
      try {
        const payload = {
          shop: shop,
          email: null,
          productId: String(product.id),
          variantId: String(activeVariant.id),
          variantTitle: activeVariant.title,
          productTitle: product.title,
          productImage: activeVariant.featured_image ? activeVariant.featured_image.src : (product.featured_image || null),
          productHandle: product.handle,
          channels: channels,
          pushSubscriptionJson: pushSubscription
        };

        const response = await fetch(`${appUrl}/api/subscribe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (result.success) {
          successCount = 1;
          if (result.count !== undefined) totalCount = result.count;
        } else {
          throw new Error(result.error || "Subscription failed");
        }
      } catch (err) {
        console.error("Subscription error:", err);
      }

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Notify Me";
      }

      // Close modal
      closeModal();

      // Show inline success card on storefront
      if (successCount > 0) {
        // Save state in localStorage
        const stateKey = "restockly-subscribed-" + activeVariant.id;
        const stateVal = JSON.stringify({ channels: channels, count: totalCount });
        localStorage.setItem(stateKey, stateVal);

        if (subscribedCard) {
          const titleEl = subscribedCard.querySelector(".restockly-subscribed-title");
          if (titleEl && confirmMsg) titleEl.textContent = confirmMsg;
        }

        if (subscribedMsg) {
          subscribedMsg.textContent = "We'll send push notifications when this is back in stock.";
        }

        if (subscribedCount) {
          subscribedCount.textContent = `${Math.max(0, totalCount - 1)} others are also waiting for this item.`;
        }

        if (notifyBtn) notifyBtn.style.display = "none";
        if (subscribedCard) subscribedCard.style.display = "flex";
      }
    });
  }

  // Utility helper for Web Push VAPID key conversions
  function urlB64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/\-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  // Parse restockly_sub_id from URL and write to cart attributes
  function handleCartAttribution() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const subId = urlParams.get("restockly_sub_id");
      if (subId) {
        fetch("/cart/update.js", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            attributes: {
              restockly_sub_id: subId,
            },
          }),
        })
          .then((res) => res.json())
          .then((data) => {
            console.log("Restockly cart attribution set successfully:", subId);
          })
          .catch((err) => {
            console.warn("Failed to set Restockly cart attribution:", err);
          });
      }
    } catch (err) {
      console.warn("Error handling Restockly cart attribution:", err);
    }
  }

  // Initialize
  async function init() {
    injectWidgetWrapper();
    await loadSettings();
    handleCartAttribution();
    currentVariantId = getSelectedVariantId();
    updateWidgetLayout(currentVariantId);
    startVariantPolling();
  }
  init();

})();
