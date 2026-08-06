import Alpine from '@alpinejs/csp';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { supabase } from './lib/supabaseClient.js';
import './style.css';

window.Alpine = Alpine;

const PLAN_LABELS = { basic: 'בסיסי — ₪89/חודש', featured: 'מומלץ — ₪230/חודש' };

// The CSP-safe Alpine build never uses eval/new Function, which our strict
// script-src 'self' CSP requires — but it means x-data can't call an
// arbitrary function expression like "app()" (there's no scope yet to
// resolve that safely). Alpine.data() registers a named component instead,
// referenced from index.html as the bare identifier x-data="app".
Alpine.data('app', () => ({
    view: 'loading',
    session: null,
    email: '',
    password: '',
    loginMode: 'magic',
    magicLinkSent: false,
    sending: false,
    authError: '',
    statusMsg: '',
    onboarding: { orgName: '', businessName: '', slug: '', acceptedTerms: false },
    org: null,
    business: null,
    businesses: [],
    newBranchName: '',
    newBranchSlug: '',
    subscription: null,
    card: {},
    cards: [],
    pendingBgFile: null,
    bgPreviewDataUrl: null,
    customers: [],
    customerSearchQuery: '',
    historyCustomerId: null,
    customerHistory: [],
    activeTab: 'card',
    campaignMessage: '',
    campaignsSentThisMonth: 0,
    campaignRequests: [],
    qrDataUrl: '',
    enrollUrl: '',
    planLabels: PLAN_LABELS,
    mfaFactors: [],
    mfaChallengeFactorId: null,
    mfaChallengeId: null,
    mfaChallengeCode: '',
    mfaEnrollFactorId: null,
    mfaEnrollQr: '',
    mfaEnrollSecret: '',
    mfaEnrollCode: '',
    isPlatformAdmin: false,
    adminClients: [],
    adminClientSearchQuery: '',
    adminSelectedClient: null,
    preAdminView: 'dashboard',
    purchaseAmounts: {},
    redeemAmounts: {},
    scannerActive: false,
    scannerStream: null,
    scannerLoopId: null,
    scannedCustomer: null,
    scanError: '',
    scanPurchaseAmount: '',
    scanRedeemAmount: '',
    myRole: null,
    myBusinessId: null,
    teamMembers: [],
    inviteEmail: '',
    invitePassword: '',
    inviteRole: 'staff',
    inviteBusinessId: '',
    inviteResult: null,
    chainInviteToken: null,
    newBranchManagerEmail: '',
    newBranchManagerPassword: '',
    adminChainPrice: '',
    adminChainInviteLink: '',

    get canOnboard() {
      return this.onboarding.orgName && this.onboarding.businessName && this.onboarding.slug && this.onboarding.acceptedTerms;
    },
    get isBasicPlan() {
      return this.subscription?.plan_tier === 'basic';
    },
    get isChainPlan() {
      return this.subscription?.plan_tier === 'chain';
    },
    get canAddCard() {
      return !this.isBasicPlan || this.cards.length === 0;
    },
    get canAddBranch() {
      return this.isChainPlan;
    },
    get isOwner() {
      return this.myRole === 'owner';
    },
    get isManager() {
      return this.myRole === 'manager';
    },
    get canManageTeam() {
      return this.isOwner || this.isManager;
    },
    get canViewCustomers() {
      return this.isOwner || this.isManager;
    },
    get filteredCustomers() {
      const q = this.customerSearchQuery.trim();
      if (!q) return this.customers;
      return this.customers.filter((c) => (c.name || '').includes(q) || (c.phone || '').includes(q));
    },
    get filteredAdminClients() {
      const q = this.adminClientSearchQuery.trim();
      if (!q) return this.adminClients;
      return this.adminClients.filter((c) => (c.org_name || '').includes(q));
    },
    get messagesRemaining() {
      return this.isBasicPlan ? Math.max(0, 4 - this.campaignsSentThisMonth) : null;
    },
    // Alpine's CSP-safe parser doesn't support inline arrow functions
    // (.some(f => ...)) in directive expressions — moved here as getters.
    get hasMfaEnrolled() {
      return this.mfaFactors.some((f) => f.status === 'verified');
    },
    get verifiedMfaFactors() {
      return this.mfaFactors.filter((f) => f.status === 'verified');
    },
    get pendingCampaignRequests() {
      return this.campaignRequests.filter((r) => r.status === 'pending');
    },
    get previewImageUrl() {
      return this.bgPreviewDataUrl || this.card.background_image_url || '';
    },
    get previewGradient() {
      const c1 = this.card.color_c1 || '#1c2b3a';
      const c2 = this.card.color_c2 || '#0f766e';
      return 'linear-gradient(160deg, ' + c1 + ', ' + c2 + ')';
    },

    async init() {
      // A magic-link email round-trip often opens in a fresh tab, losing any
      // in-memory state — persisted to localStorage so the chain-invite token
      // survives from "opened the link" through "clicked the magic-link email".
      const params = new URLSearchParams(window.location.search);
      const token = params.get('chain_invite');
      if (token) {
        localStorage.setItem('arnakit_chain_invite', token);
        params.delete('chain_invite');
        const rest = params.toString();
        window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''));
      }
      this.chainInviteToken = token || localStorage.getItem('arnakit_chain_invite');

      const { data: { session } } = await supabase.auth.getSession();
      this.session = session;
      // A fresh magic-link redirect often hasn't finished exchanging the URL's
      // auth token yet at this point — getSession() can still return null here,
      // so checkPlatformAdmin() below silently no-ops. onAuthStateChange fires
      // afterward with the real session, so it needs its own admin check too,
      // not just loadOrg() — otherwise a first-time signup right after clicking
      // the email link never actually becomes platform admin.
      supabase.auth.onAuthStateChange((_event, session) => {
        this.session = session;
        this.checkPlatformAdmin().then(() => this.loadOrg());
      });
      await this.checkPlatformAdmin();
      await this.loadOrg();
    },

    async checkPlatformAdmin() {
      if (!this.session) return;
      try {
        // No-op for everyone except whoever is first to call it — see
        // migration 0012's bootstrap_platform_admin(). Safe to call every load.
        const { error: rpcError } = await supabase.rpc('bootstrap_platform_admin');
        // "authentication required" fires if this runs before the session is
        // fully live yet (see init()) — expected and harmless, the retry from
        // onAuthStateChange covers it. Anything else is worth seeing.
        if (rpcError && rpcError.message !== 'authentication required') {
          console.error('bootstrap_platform_admin failed', rpcError);
        }
        const { data } = await supabase
          .from('platform_admins')
          .select('user_id')
          .eq('user_id', this.session.user.id)
          .maybeSingle();
        this.isPlatformAdmin = !!data;
      } catch (err) {
        console.error('checkPlatformAdmin failed', err);
      }
    },

    async openAdminPanel() {
      this.preAdminView = this.view;
      this.view = 'admin';
      this.sending = true;
      const { data, error } = await supabase.functions.invoke('admin-list-clients');
      this.sending = false;
      if (error) { this.statusMsg = error.message; return; }
      this.adminClients = data.clients;
    },

    closeAdminPanel() {
      this.view = this.preAdminView;
      this.adminSelectedClient = null;
    },

    async openAdminClientDetail(orgId) {
      this.sending = true;
      const { data, error } = await supabase.functions.invoke('admin-client-detail', {
        body: { org_id: orgId },
      });
      this.sending = false;
      if (error) { this.statusMsg = error.message; return; }
      this.adminSelectedClient = data;
      this.adminChainPrice = data.subscription?.custom_price_agorot ? String(data.subscription.custom_price_agorot / 100) : '';
    },

    async adminSaveChainPrice() {
      this.sending = true;
      this.statusMsg = '';
      const price = this.adminChainPrice ? Math.round(parseFloat(this.adminChainPrice) * 100) : null;
      const { error } = await supabase.functions.invoke('admin-set-chain-price', {
        body: { org_id: this.adminSelectedClient.org.id, price_agorot: price },
      });
      this.sending = false;
      if (error) { this.statusMsg = error.message; return; }
      this.statusMsg = 'המחיר עודכן.';
      await this.openAdminClientDetail(this.adminSelectedClient.org.id);
    },

    async adminCancelSubscription() {
      if (!confirm('לבטל את המנוי של הלקוח הזה? הכרטיסים שלו יושבתו מיד.')) return;
      this.sending = true;
      this.statusMsg = '';
      const { error } = await supabase.functions.invoke('admin-cancel-subscription', {
        body: { org_id: this.adminSelectedClient.org.id },
      });
      this.sending = false;
      if (error) { this.statusMsg = error.message; return; }
      this.statusMsg = 'המנוי בוטל.';
      await this.openAdminClientDetail(this.adminSelectedClient.org.id);
    },

    async adminDeleteCard(cardId) {
      if (!confirm('למחוק את הכרטיס הזה לצמיתות? הלקוחות והנקודות שלהם לא יימחקו, רק הגדרות הכרטיס.')) return;
      this.sending = true;
      this.statusMsg = '';
      const { error } = await supabase.functions.invoke('admin-delete-card', {
        body: { org_id: this.adminSelectedClient.org.id, card_id: cardId },
      });
      this.sending = false;
      if (error) { this.statusMsg = error.message; return; }
      this.statusMsg = 'הכרטיס נמחק.';
      await this.openAdminClientDetail(this.adminSelectedClient.org.id);
    },

    async adminGenerateChainInviteLink() {
      if (!this.adminChainPrice) return;
      this.sending = true;
      this.statusMsg = '';
      this.adminChainInviteLink = '';
      const price = Math.round(parseFloat(this.adminChainPrice) * 100);
      const { data, error } = await supabase.functions.invoke('admin-create-chain-invite', {
        body: { price_agorot: price },
      });
      this.sending = false;
      if (error) { this.statusMsg = error.message; return; }
      this.adminChainInviteLink = data.link;
    },

    // The CSP-safe Alpine build's expression parser doesn't support multiple
    // ";"-separated statements in a single directive (e.g. @click="a=1; b()")
    // — every tab that needed "switch tab AND load its data" silently failed
    // to do either. Each needs its own single-call method instead.
    switchToPasswordLogin() {
      this.loginMode = 'password';
      this.authError = '';
    },
    switchToMagicLogin() {
      this.loginMode = 'magic';
      this.authError = '';
    },
    openCustomersTab() {
      this.activeTab = 'customers';
      this.loadCustomers();
    },
    openBillingTab() {
      this.activeTab = 'billing';
      this.loadSubscription();
    },
    openSecurityTab() {
      this.activeTab = 'security';
      this.loadMfaFactors();
    },
    openTeamTab() {
      this.activeTab = 'team';
      this.loadTeam();
    },
    openCampaignsTab() {
      this.activeTab = 'campaigns';
      this.loadCampaignRequests();
    },

    async sendMagicLink() {
      this.sending = true;
      this.authError = '';
      const redirectTo = this.chainInviteToken
        ? `${window.location.origin}/?chain_invite=${this.chainInviteToken}`
        : window.location.origin;
      const { error } = await supabase.auth.signInWithOtp({
        email: this.email,
        options: { emailRedirectTo: redirectTo },
      });
      this.sending = false;
      if (error) { this.authError = error.message; return; }
      this.magicLinkSent = true;
    },

    async signInWithPassword() {
      this.sending = true;
      this.authError = '';
      const { error } = await supabase.auth.signInWithPassword({
        email: this.email,
        password: this.password,
      });
      this.sending = false;
      if (error) { this.authError = 'אימייל או סיסמה שגויים.'; return; }
      this.password = '';
    },

    async signOut() {
      await supabase.auth.signOut();
      this.session = null;
      this.view = 'login';
    },

    async loadOrg() {
      if (!this.session) { this.view = 'login'; return; }
      try {
        await this._loadOrgInner();
      } catch (err) {
        // Anything unexpected below used to leave the screen stuck on "טוען..."
        // forever (view starts at 'loading' and nothing here ever re-set it on
        // a thrown error) — surface it instead of hanging silently.
        console.error('loadOrg failed', err);
        this.authError = err.message || String(err);
        this.view = 'login';
      }
    },

    async _loadOrgInner() {
      // Step-up check: if the account has 2FA enrolled, a plain magic-link login
      // only reaches aal1 — block access to org data until the TOTP challenge
      // (aal2) passes, so a stolen/forwarded magic-link email alone isn't enough.
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== aal.nextLevel) {
        const { data: factorsData } = await supabase.auth.mfa.listFactors();
        const factor = factorsData?.totp?.find((f) => f.status === 'verified');
        if (factor) {
          this.mfaChallengeFactorId = factor.id;
          const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: factor.id });
          if (challengeError) { this.authError = challengeError.message; return; }
          this.mfaChallengeId = challenge.id;
          this.view = 'mfa-challenge';
          return;
        }
      }

      const { data: memberships, error } = await supabase
        .from('org_members')
        .select('org_id, role, business_id')
        .eq('user_id', this.session.user.id)
        .limit(1);

      if (error) { this.authError = error.message; return; }

      if (!memberships || memberships.length === 0) {
        this.view = 'onboarding';
        return;
      }

      const { data: orgRow } = await supabase.from('orgs').select('id, name').eq('id', memberships[0].org_id).single();
      this.org = orgRow || { id: memberships[0].org_id };
      this.myRole = memberships[0].role;
      this.myBusinessId = memberships[0].business_id;
      // Default activeTab is 'card', an owner-only tab — a staff/manager
      // account would otherwise land there on login with no button to have
      // gotten them there (the tab content itself is also gated, but this
      // avoids briefly showing the wrong starting tab at all).
      if (this.myRole !== 'owner' && this.activeTab === 'card') {
        this.activeTab = 'scan';
      }

      const { data: businesses } = await supabase
        .from('businesses')
        .select('*')
        .eq('org_id', this.org.id)
        .order('created_at', { ascending: true });

      if (!businesses || businesses.length === 0) {
        this.view = 'onboarding';
        return;
      }

      this.businesses = businesses;
      this.business = businesses[0];

      await this.loadSubscription();

      const params = new URLSearchParams(window.location.search);
      if (params.get('billing') === 'success' && this.subscription?.status !== 'active') {
        await this.pollForActiveSubscription();
      }

      if (this.subscription?.status !== 'active') {
        this.view = 'paywall';
        return;
      }

      await this.loadCards();
      this.buildEnrollUrl();
      this.view = 'dashboard';
    },

    async pollForActiveSubscription() {
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        await this.loadSubscription();
        if (this.subscription?.status === 'active') return;
      }
    },

    async loadSubscription() {
      const { data } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('org_id', this.org.id)
        .maybeSingle();
      this.subscription = data || null;
    },

    async loadTeam() {
      let query = supabase
        .from('org_members')
        .select('user_id, email, role, business_id')
        .eq('org_id', this.org.id)
        .order('role', { ascending: true });
      // A manager only manages their own branch's staff — no need (or RLS
      // right) to see other branches' rosters, so filter it client-side too.
      if (this.isManager) query = query.or(`role.eq.owner,business_id.eq.${this.myBusinessId}`);
      const { data } = await query;
      this.teamMembers = data || [];
    },

    branchName(businessId) {
      return this.businesses.find((b) => b.id === businessId)?.name || '';
    },

    async inviteStaffMember() {
      if (!this.inviteEmail || this.invitePassword.length < 6) return;
      if (this.isOwner && this.inviteRole === 'manager' && !this.inviteBusinessId) return;
      this.sending = true;
      this.statusMsg = '';
      this.inviteResult = null;
      const body = { org_id: this.org.id, email: this.inviteEmail, password: this.invitePassword };
      if (this.isOwner) {
        body.role = this.inviteRole;
        if (this.inviteRole === 'manager') body.business_id = this.inviteBusinessId;
      }
      const { data, error } = await supabase.functions.invoke('invite-staff', { body });
      this.sending = false;
      if (error) { this.statusMsg = error.message; return; }
      this.inviteResult = {
        email: this.inviteEmail,
        password: data?.password_set ? this.invitePassword : null,
        alreadyExisted: !data?.password_set,
      };
      this.inviteEmail = '';
      this.invitePassword = '';
      this.inviteRole = 'staff';
      this.inviteBusinessId = '';
      await this.loadTeam();
    },

    async removeStaffMember(userId) {
      if (!confirm('להסיר את העובד/ת הזו מהצוות?')) return;
      const { error } = await supabase.from('org_members').delete().eq('org_id', this.org.id).eq('user_id', userId);
      if (error) { this.statusMsg = error.message; return; }
      await this.loadTeam();
    },

    async cancelSubscription() {
      if (!this.isOwner) return;
      if (!confirm('לבטל את המנוי? כרטיס הנאמנות שלכם יופסק וללקוחות חדשים לא יוכלו להירשם עוד.')) return;
      this.sending = true;
      this.statusMsg = '';
      const { error } = await supabase.functions.invoke('cancel-subscription', {
        body: { org_id: this.org.id },
      });
      this.sending = false;
      if (error) { this.statusMsg = error.message; return; }
      await this.loadSubscription();
      this.statusMsg = 'המנוי בוטל.';
    },

    async subscribeToPlan(planTier) {
      this.sending = true;
      this.authError = '';
      const { data, error } = await supabase.functions.invoke('create-checkout-session', {
        body: { org_id: this.org.id, plan_tier: planTier },
      });
      this.sending = false;
      if (error) { this.authError = error.message; return; }
      window.location.href = data.redirectUrl;
    },

    async completeOnboarding() {
      this.sending = true;
      this.authError = '';
      const usedChainInvite = this.chainInviteToken;
      const { error } = await supabase.rpc('create_org_with_business', {
        p_org_name: this.onboarding.orgName,
        p_business_name: this.onboarding.businessName,
        p_business_slug: this.onboarding.slug,
        p_accepted_terms: this.onboarding.acceptedTerms,
        p_chain_invite_token: usedChainInvite,
      });
      this.sending = false;
      if (error) {
        // A taken slug bubbles up as a raw Postgres constraint error — surface
        // something a non-technical owner can act on instead.
        this.authError = error.message.includes('businesses_slug_key')
          ? 'הכתובת הציבורית הזו כבר תפוסה — נסו כתובת אחרת.'
          : error.message;
        return;
      }
      localStorage.removeItem('arnakit_chain_invite');
      this.chainInviteToken = null;
      await this.loadOrg();
      // Admin-priced chain signups skip the plan picker entirely — go straight
      // to Cardcom to save a card at the price the admin already fixed.
      if (usedChainInvite) await this.subscribeToPlan('chain');
    },

    selectBranch(businessId) {
      this.business = this.businesses.find((b) => b.id === businessId) || this.business;
      this.buildEnrollUrl();
    },

    async createBranch() {
      if (!this.canAddBranch || !this.newBranchName || !this.newBranchSlug) return;
      if (this.newBranchManagerEmail && this.newBranchManagerPassword.length < 6) return;
      this.sending = true;
      this.statusMsg = '';
      const { data, error } = await supabase.rpc('create_business_for_org', {
        p_org_id: this.org.id,
        p_name: this.newBranchName,
        p_slug: this.newBranchSlug,
      });
      if (error) { this.sending = false; this.statusMsg = error.message; return; }
      const { data: business } = await supabase.from('businesses').select('*').eq('id', data).single();
      this.businesses.push(business);
      this.newBranchName = '';
      this.newBranchSlug = '';

      if (this.newBranchManagerEmail) {
        const { data: inviteData, error: inviteError } = await supabase.functions.invoke('invite-staff', {
          body: {
            org_id: this.org.id,
            email: this.newBranchManagerEmail,
            password: this.newBranchManagerPassword,
            role: 'manager',
            business_id: business.id,
          },
        });
        if (inviteError) {
          this.statusMsg = 'הסניף נוסף, אך הזמנת המנהל/ת נכשלה: ' + inviteError.message;
        } else {
          this.inviteResult = {
            email: this.newBranchManagerEmail,
            password: inviteData?.password_set ? this.newBranchManagerPassword : null,
            alreadyExisted: !inviteData?.password_set,
          };
        }
        this.newBranchManagerEmail = '';
        this.newBranchManagerPassword = '';
        await this.loadTeam();
      }
      this.sending = false;
    },

    async loadCards() {
      // Cards belong to the org (shared chain-wide across every branch), not to
      // a single business — this is what lets a customer use their points at
      // any location of the same chain.
      const { data } = await supabase
        .from('loyalty_cards')
        .select('*')
        .eq('org_id', this.org.id)
        .order('created_at', { ascending: true });
      this.cards = data || [];
      this.card = this.cards[0] || {};
      await this.loadCampaignQuotaUsage();
    },

    selectCard(cardId) {
      this.card = this.cards.find((c) => c.id === cardId) || {};
    },

    async createNewCard() {
      if (!this.canAddCard) return;
      this.sending = true;
      const { data, error } = await supabase
        .from('loyalty_cards')
        .insert({
          org_id: this.org.id,
          name: 'כרטיס חדש',
          reward_type: 'stamps',
          target_count: 10,
          reward_description: '10 = מתנה',
        })
        .select('*')
        .single();
      this.sending = false;
      if (error) { this.statusMsg = error.message; return; }
      this.cards.push(data);
      this.card = data;
    },

    setColor(c1, c2, stamp) {
      this.card.color_c1 = c1;
      this.card.color_c2 = c2;
      this.card.stamp_color = stamp;
    },

    async saveCard() {
      this.sending = true;
      this.statusMsg = '';

      // The chosen file only gets uploaded now, at actual save time — until
      // then it's just previewed locally in the demo phones, so a merchant
      // can try a few images without touching the real card each time.
      let backgroundImageUrl = this.card.background_image_url;
      if (this.pendingBgFile) {
        const path = `${this.org.id}/${Date.now()}-${this.pendingBgFile.name}`;
        const { error: uploadError } = await supabase.storage
          .from('card-backgrounds')
          .upload(path, this.pendingBgFile);
        if (uploadError) { this.sending = false; this.statusMsg = uploadError.message; return; }
        const { data } = supabase.storage.from('card-backgrounds').getPublicUrl(path);
        backgroundImageUrl = data.publicUrl;
      }

      const { error } = await supabase
        .from('loyalty_cards')
        .update({
          name: this.card.name,
          reward_type: this.card.reward_type,
          target_count: this.card.target_count,
          stamp_cooldown_enabled: this.card.stamp_cooldown_enabled,
          reward_description: this.card.reward_description,
          color_c1: this.card.color_c1,
          color_c2: this.card.color_c2,
          stamp_color: this.card.stamp_color,
          credit_earn_rate_percent: this.card.credit_earn_rate_percent,
          background_image_url: backgroundImageUrl,
        })
        .eq('id', this.card.id);
      this.sending = false;
      if (error) { this.statusMsg = error.message; return; }
      this.card.background_image_url = backgroundImageUrl;
      this.pendingBgFile = null;
      this.statusMsg = 'נשמר בהצלחה.';
    },

    previewBackground(evt) {
      const file = evt.target.files[0];
      if (!file) return;
      this.pendingBgFile = file;
      const reader = new FileReader();
      reader.onload = () => {
        this.bgPreviewDataUrl = reader.result;
      };
      reader.readAsDataURL(file);
    },

    async loadCustomers() {
      // Org-wide: a chain's customer list is shared across all its branches.
      const { data } = await supabase
        .from('customers')
        .select('*')
        .eq('org_id', this.org.id)
        .order('last_visit_at', { ascending: false, nullsFirst: false });
      this.customers = data || [];
    },

    // Camera scanner: reads the barcode already printed on the customer's
    // issued wallet pass (encodes pass_serial_number) — this is the fast,
    // no-typing way for staff to identify a returning customer, instead of
    // hunting for them in the customer list every visit.
    async startScanner() {
      this.scanError = '';
      this.scannedCustomer = null;
      // A previous stream's tracks may already be stopped, but the <video>
      // element itself can still hold onto the old srcObject — on some
      // browsers (notably mobile Safari) that stale state stops a second
      // getUserMedia stream from ever showing, so the camera silently never
      // comes back after scanning one customer. Force a clean slate first.
      this.stopScanner();
      try {
        this.scannerStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
      } catch (err) {
        this.scanError = 'לא ניתן לגשת למצלמה — ודאו שנתתם הרשאה בדפדפן.';
        return;
      }
      this.scannerActive = true;
      const video = this.$refs.scannerVideo;
      video.srcObject = this.scannerStream;
      await video.play();
      const canvas = this.$refs.scannerCanvas;
      const ctx = canvas.getContext('2d');

      const tick = () => {
        if (!this.scannerActive) return;
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          if (code && code.data) {
            this.handleScanResult(code.data);
            return;
          }
        }
        this.scannerLoopId = requestAnimationFrame(tick);
      };
      this.scannerLoopId = requestAnimationFrame(tick);
    },

    stopScanner() {
      this.scannerActive = false;
      if (this.scannerLoopId) cancelAnimationFrame(this.scannerLoopId);
      if (this.scannerStream) this.scannerStream.getTracks().forEach((t) => t.stop());
      this.scannerStream = null;
      const video = this.$refs.scannerVideo;
      if (video) {
        video.pause();
        video.srcObject = null;
      }
    },

    async handleScanResult(serialNumber) {
      this.stopScanner();
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('org_id', this.org.id)
        .eq('pass_serial_number', serialNumber)
        .maybeSingle();

      if (error || !data) {
        // Clear any previously-scanned customer too — otherwise a failed
        // rescan leaves the last customer's card on screen behind the error
        // message, and a staff member who doesn't notice could add a stamp
        // to the wrong person.
        this.scanError = 'הכרטיס לא זוהה — ודאו שזה כרטיס של הרשת שלכם.';
        this.scannedCustomer = null;
        return;
      }
      this.scannedCustomer = data;
    },

    rescan() {
      this.scannedCustomer = null;
      this.startScanner();
    },

    async scannedAddStamp() {
      await this.addStamp(this.scannedCustomer.id);
      const { data } = await supabase.from('customers').select('*').eq('id', this.scannedCustomer.id).maybeSingle();
      this.scannedCustomer = data;
    },

    async scannedRecordPurchase() {
      const amount = Number(this.scanPurchaseAmount);
      if (!amount || amount <= 0) return;
      const rate = this.card.credit_earn_rate_percent ?? 10;
      const earnedAgorot = Math.round(amount * (rate / 100) * 100);
      const { error } = await supabase.from('stamp_events').insert({
        customer_id: this.scannedCustomer.id,
        org_id: this.org.id,
        delta: earnedAgorot,
        type: 'credit',
        created_by: this.session.user.id,
        note: `רכישה בסך ₪${amount}`,
      });
      if (error) { this.statusMsg = error.message; return; }
      this.scanPurchaseAmount = '';
      const { data } = await supabase.from('customers').select('*').eq('id', this.scannedCustomer.id).maybeSingle();
      this.scannedCustomer = data;
    },

    async scannedRedeemCredit() {
      const amount = Number(this.scanRedeemAmount);
      if (!amount || amount <= 0) return;
      const { error } = await supabase.from('stamp_events').insert({
        customer_id: this.scannedCustomer.id,
        org_id: this.org.id,
        delta: -Math.round(amount * 100),
        type: 'redeem',
        created_by: this.session.user.id,
        note: `מימוש ₪${amount}`,
      });
      if (error) { this.statusMsg = error.message; return; }
      this.scanRedeemAmount = '';
      const { data } = await supabase.from('customers').select('*').eq('id', this.scannedCustomer.id).maybeSingle();
      this.scannedCustomer = data;
    },

    async scannedRedeemStampReward() {
      const { error } = await supabase.from('stamp_events').insert({
        customer_id: this.scannedCustomer.id,
        org_id: this.org.id,
        delta: -this.scannedCustomer.stamps_count,
        type: 'reset',
        created_by: this.session.user.id,
        note: 'מימוש פרס',
      });
      if (error) { this.statusMsg = error.message; return; }
      const { data } = await supabase.from('customers').select('*').eq('id', this.scannedCustomer.id).maybeSingle();
      this.scannedCustomer = data;
    },

    async addStamp(customerId) {
      const { error } = await supabase.from('stamp_events').insert({
        customer_id: customerId,
        org_id: this.org.id,
        delta: 1,
        type: 'stamp',
        created_by: this.session.user.id,
      });
      if (!error) {
        await this.loadCustomers();
        return;
      }
      this.statusMsg = error.message.includes('stamp_cooldown_active')
        ? 'הלקוח/ה כבר קיבל/ה תו ב-24 השעות האחרונות.'
        : error.message;
    },

    // Credit-mode cards: the restaurateur enters the sale amount and the system
    // computes the earned credit automatically from the card's configured rate —
    // no manual percentage math for them to get wrong.
    async recordPurchase(customerId) {
      const amount = Number(this.purchaseAmounts[customerId]);
      if (!amount || amount <= 0) return;
      const rate = this.card.credit_earn_rate_percent ?? 10;
      const earnedAgorot = Math.round(amount * (rate / 100) * 100);
      const { error } = await supabase.from('stamp_events').insert({
        customer_id: customerId,
        org_id: this.org.id,
        delta: earnedAgorot,
        type: 'credit',
        created_by: this.session.user.id,
        note: `רכישה בסך ₪${amount}`,
      });
      if (!error) {
        this.purchaseAmounts[customerId] = '';
        await this.loadCustomers();
      } else {
        this.statusMsg = error.message;
      }
    },

    // Customer wants to spend N points/credit on something — deducts it.
    async redeemCredit(customerId) {
      const amount = Number(this.redeemAmounts[customerId]);
      if (!amount || amount <= 0) return;
      const { error } = await supabase.from('stamp_events').insert({
        customer_id: customerId,
        org_id: this.org.id,
        delta: -Math.round(amount * 100),
        type: 'redeem',
        created_by: this.session.user.id,
        note: `מימוש ₪${amount}`,
      });
      if (!error) {
        this.redeemAmounts[customerId] = '';
        await this.loadCustomers();
      } else {
        this.statusMsg = error.message;
      }
    },

    // Stamp card hit its target (e.g. 10/10) — resets the counter once the
    // reward has been handed over.
    async redeemStampReward(customerId, currentCount) {
      const { error } = await supabase.from('stamp_events').insert({
        customer_id: customerId,
        org_id: this.org.id,
        delta: -currentCount,
        type: 'reset',
        created_by: this.session.user.id,
        note: 'מימוש פרס',
      });
      if (!error) await this.loadCustomers();
      else this.statusMsg = error.message;
    },

    // Lets an owner/manager spot abuse (e.g. the same customer racking up
    // stamps a minute apart) by seeing exactly when each one was recorded.
    async openCustomerHistory(customerId) {
      this.historyCustomerId = customerId;
      const { data } = await supabase
        .from('stamp_events')
        .select('id, type, delta, note, created_at')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(100);
      this.customerHistory = data || [];
    },

    // CSP-safe Alpine can't parse "new Date(...)" inline in an x-text
    // expression (the "new" keyword isn't supported by its restricted
    // expression parser) — same class of bug as the ?./arrow-function issues
    // fixed earlier, just newly hit here. Format dates in a real method
    // instead of inline in the template.
    formatDate(dateStr) {
      return dateStr ? new Date(dateStr).toLocaleDateString('he-IL') : '—';
    },
    formatDateTime(dateStr) {
      return dateStr ? new Date(dateStr).toLocaleString('he-IL') : '—';
    },

    closeCustomerHistory() {
      this.historyCustomerId = null;
      this.customerHistory = [];
    },

    async loadCampaignQuotaUsage() {
      if (this.subscription?.plan_tier !== 'basic') { this.campaignsSentThisMonth = 0; return; }
      const periodStart = this.subscription.current_period_start
        || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
      const { count } = await supabase
        .from('push_campaigns')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', this.org.id)
        .eq('status', 'sent')
        .gte('sent_at', periodStart);
      this.campaignsSentThisMonth = count || 0;
    },

    async sendCampaign() {
      this.sending = true;
      this.statusMsg = '';
      const { error } = await supabase.functions.invoke('send-campaign', {
        body: { org_id: this.org.id, message: this.campaignMessage },
      });
      this.sending = false;
      if (error) { this.statusMsg = error.message; return; }
      this.statusMsg = 'הקמפיין נשלח.';
      this.campaignMessage = '';
      await this.loadCampaignQuotaUsage();
    },

    async loadCampaignRequests() {
      const { data } = await supabase
        .from('campaign_requests')
        .select('*')
        .eq('org_id', this.org.id)
        .order('created_at', { ascending: false });
      this.campaignRequests = data || [];
    },

    async submitCampaignRequest() {
      this.sending = true;
      this.statusMsg = '';
      const { error } = await supabase.functions.invoke('request-campaign', {
        body: { org_id: this.org.id, message: this.campaignMessage },
      });
      this.sending = false;
      if (error) { this.statusMsg = error.message; return; }
      this.statusMsg = 'הבקשה נשלחה לאישור הבעלים.';
      this.campaignMessage = '';
      await this.loadCampaignRequests();
    },

    async respondToCampaignRequest(requestId, decision) {
      this.sending = true;
      this.statusMsg = '';
      const { error } = await supabase.functions.invoke('respond-campaign-request', {
        body: { request_id: requestId, decision },
      });
      this.sending = false;
      if (error) { this.statusMsg = error.message; return; }
      this.statusMsg = decision === 'approved' ? 'הקמפיין אושר ונשלח.' : 'הבקשה נדחתה.';
      await this.loadCampaignRequests();
      await this.loadCampaignQuotaUsage();
    },

    async submitMfaChallenge() {
      this.sending = true;
      this.authError = '';
      const { error } = await supabase.auth.mfa.verify({
        factorId: this.mfaChallengeFactorId,
        challengeId: this.mfaChallengeId,
        code: this.mfaChallengeCode,
      });
      this.sending = false;
      if (error) { this.authError = error.message; return; }
      this.mfaChallengeCode = '';
      await this.loadOrg();
    },

    async loadMfaFactors() {
      const { data } = await supabase.auth.mfa.listFactors();
      this.mfaFactors = data?.totp || [];
    },

    async startMfaEnrollment() {
      this.sending = true;
      this.statusMsg = '';
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
      this.sending = false;
      if (error) { this.statusMsg = error.message; return; }
      this.mfaEnrollFactorId = data.id;
      this.mfaEnrollQr = data.totp.qr_code;
      this.mfaEnrollSecret = data.totp.secret;
    },

    async confirmMfaEnrollment() {
      this.sending = true;
      this.statusMsg = '';
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: this.mfaEnrollFactorId });
      if (challengeError) { this.sending = false; this.statusMsg = challengeError.message; return; }
      const { error } = await supabase.auth.mfa.verify({
        factorId: this.mfaEnrollFactorId,
        challengeId: challenge.id,
        code: this.mfaEnrollCode,
      });
      this.sending = false;
      if (error) { this.statusMsg = error.message; return; }
      this.mfaEnrollFactorId = null;
      this.mfaEnrollQr = '';
      this.mfaEnrollSecret = '';
      this.mfaEnrollCode = '';
      this.statusMsg = 'אימות דו-שלבי הופעל בהצלחה.';
      await this.loadMfaFactors();
    },

    async removeMfaFactor(factorId) {
      this.sending = true;
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      this.sending = false;
      if (error) { this.statusMsg = error.message; return; }
      await this.loadMfaFactors();
    },

    printPoster() {
      if (!this.qrDataUrl) return;
      const c1 = this.card?.color_c1 || '#1c2b3a';
      const c2 = this.card?.color_c2 || '#0f766e';
      const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const title = esc(this.business?.name || this.card?.name || 'ארנקית');
      const reward = esc(this.card?.reward_description || '');
      const win = window.open('', '_blank', 'width=850,height=1200');
      if (!win) { this.statusMsg = 'יש לאפשר חלונות קופצים כדי להדפיס.'; return; }
      win.document.write(`<!doctype html>
<html dir="rtl" lang="he"><head><meta charset="utf-8"><title>${title}</title>
<style>
  @page { size: A4; margin: 0; }
  body { margin:0; font-family: Rubik, Arial, sans-serif; }
  .poster { width:100vw; height:100vh; box-sizing:border-box; padding:60px 40px;
    background: linear-gradient(160deg, ${c1}, ${c2}); color:#fff; text-align:center;
    display:flex; flex-direction:column; align-items:center; justify-content:center; }
  .poster h1 { font-size:46px; margin:0 0 8px; }
  .poster .sub { font-size:24px; opacity:0.9; margin-bottom:40px; }
  .poster .qr { background:#fff; padding:24px; border-radius:24px; }
  .poster .qr img { width:340px; height:340px; display:block; }
  .poster .cta { font-size:30px; font-weight:700; margin-top:36px; }
  .poster .reward { font-size:20px; opacity:0.9; margin-top:10px; }
  .poster .brand { position:absolute; bottom:30px; font-size:14px; opacity:0.6; }
  @media print { .poster { padding:40px; } }
</style></head>
<body>
  <div class="poster">
    <h1>${title}</h1>
    <p class="sub">מועדון הלקוחות שלנו</p>
    <div class="qr"><img src="${this.qrDataUrl}"></div>
    <p class="cta">סרקו והצטרפו בשניות</p>
    ${reward ? `<p class="reward">${reward}</p>` : ''}
    <p class="brand">מופעל ע״י Arnakit</p>
  </div>
  <script>
    window.onload = () => { window.print(); };
  </script>
</body></html>`);
      win.document.close();
    },

    buildEnrollUrl() {
      if (!this.business) return;
      const base = import.meta.env.VITE_SUPABASE_URL.replace('.supabase.co', '.functions.supabase.co');
      this.enrollUrl = `${base}/enroll?slug=${this.business.slug}`;
      QRCode.toDataURL(this.enrollUrl, { margin: 1, width: 320 }).then((url) => {
        this.qrDataUrl = url;
      });
    },
}));

Alpine.start();
