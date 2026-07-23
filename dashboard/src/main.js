import Alpine from 'alpinejs';
import QRCode from 'qrcode';
import { supabase } from './lib/supabaseClient.js';
import './style.css';

window.Alpine = Alpine;

const PLAN_LABELS = { basic: 'בסיסי — ₪89/חודש', featured: 'מומלץ — ₪230/חודש' };

window.app = function app() {
  return {
    view: 'loading',
    session: null,
    email: '',
    magicLinkSent: false,
    sending: false,
    authError: '',
    statusMsg: '',
    onboarding: { orgName: '', businessName: '', slug: '', acceptedTerms: false },
    org: null,
    business: null,
    subscription: null,
    card: {},
    cards: [],
    customers: [],
    activeTab: 'card',
    campaignMessage: '',
    campaignsSentThisMonth: 0,
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

    get canOnboard() {
      return this.onboarding.orgName && this.onboarding.businessName && this.onboarding.slug && this.onboarding.acceptedTerms;
    },
    get isBasicPlan() {
      return this.subscription?.plan_tier === 'basic';
    },
    get canAddCard() {
      return !this.isBasicPlan || this.cards.length === 0;
    },
    get messagesRemaining() {
      return this.isBasicPlan ? Math.max(0, 4 - this.campaignsSentThisMonth) : null;
    },

    async init() {
      const { data: { session } } = await supabase.auth.getSession();
      this.session = session;
      supabase.auth.onAuthStateChange((_event, session) => {
        this.session = session;
        this.loadOrg();
      });
      await this.loadOrg();
    },

    async sendMagicLink() {
      this.sending = true;
      this.authError = '';
      const { error } = await supabase.auth.signInWithOtp({
        email: this.email,
        options: { emailRedirectTo: window.location.origin },
      });
      this.sending = false;
      if (error) { this.authError = error.message; return; }
      this.magicLinkSent = true;
    },

    async signOut() {
      await supabase.auth.signOut();
      this.session = null;
      this.view = 'login';
    },

    async loadOrg() {
      if (!this.session) { this.view = 'login'; return; }

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
        .select('org_id')
        .eq('user_id', this.session.user.id)
        .limit(1);

      if (error) { this.authError = error.message; return; }

      if (!memberships || memberships.length === 0) {
        this.view = 'onboarding';
        return;
      }

      this.org = { id: memberships[0].org_id };

      const { data: businesses } = await supabase
        .from('businesses')
        .select('*')
        .eq('org_id', this.org.id)
        .order('created_at', { ascending: true });

      if (!businesses || businesses.length === 0) {
        this.view = 'onboarding';
        return;
      }

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
      const { error } = await supabase.rpc('create_org_with_business', {
        p_org_name: this.onboarding.orgName,
        p_business_name: this.onboarding.businessName,
        p_business_slug: this.onboarding.slug,
        p_accepted_terms: this.onboarding.acceptedTerms,
      });
      this.sending = false;
      if (error) { this.authError = error.message; return; }
      await this.loadOrg();
    },

    async loadCards() {
      const { data } = await supabase
        .from('loyalty_cards')
        .select('*')
        .eq('business_id', this.business.id)
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
          business_id: this.business.id,
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
      const { error } = await supabase
        .from('loyalty_cards')
        .update({
          name: this.card.name,
          reward_type: this.card.reward_type,
          target_count: this.card.target_count,
          reward_description: this.card.reward_description,
          color_c1: this.card.color_c1,
          color_c2: this.card.color_c2,
          stamp_color: this.card.stamp_color,
        })
        .eq('id', this.card.id);
      this.sending = false;
      this.statusMsg = error ? error.message : 'נשמר בהצלחה.';
    },

    async uploadBackground(evt) {
      const file = evt.target.files[0];
      if (!file) return;
      this.sending = true;
      const path = `${this.business.id}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('card-backgrounds')
        .upload(path, file);
      if (uploadError) { this.sending = false; this.statusMsg = uploadError.message; return; }
      const { data } = supabase.storage.from('card-backgrounds').getPublicUrl(path);
      const { error } = await supabase
        .from('loyalty_cards')
        .update({ background_image_url: data.publicUrl })
        .eq('id', this.card.id);
      this.card.background_image_url = data.publicUrl;
      this.sending = false;
      this.statusMsg = error ? error.message : 'התמונה עודכנה.';
    },

    async loadCustomers() {
      const { data } = await supabase
        .from('customers')
        .select('*')
        .eq('business_id', this.business.id)
        .order('last_visit_at', { ascending: false, nullsFirst: false });
      this.customers = data || [];
    },

    async addStamp(customerId) {
      const { error } = await supabase.from('stamp_events').insert({
        customer_id: customerId,
        business_id: this.business.id,
        delta: 1,
        type: 'stamp',
        created_by: this.session.user.id,
      });
      if (!error) await this.loadCustomers();
    },

    async loadCampaignQuotaUsage() {
      if (this.subscription?.plan_tier !== 'basic') { this.campaignsSentThisMonth = 0; return; }
      const periodStart = this.subscription.current_period_start
        || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
      const { count } = await supabase
        .from('push_campaigns')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', this.business.id)
        .eq('status', 'sent')
        .gte('sent_at', periodStart);
      this.campaignsSentThisMonth = count || 0;
    },

    async sendCampaign() {
      this.sending = true;
      this.statusMsg = '';
      const { error } = await supabase.functions.invoke('send-campaign', {
        body: { business_id: this.business.id, message: this.campaignMessage },
      });
      this.sending = false;
      if (error) { this.statusMsg = error.message; return; }
      this.statusMsg = 'הקמפיין נשלח.';
      this.campaignMessage = '';
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

    buildEnrollUrl() {
      if (!this.business) return;
      const base = import.meta.env.VITE_SUPABASE_URL.replace('.supabase.co', '.functions.supabase.co');
      this.enrollUrl = `${base}/enroll?slug=${this.business.slug}`;
      QRCode.toDataURL(this.enrollUrl, { margin: 1, width: 320 }).then((url) => {
        this.qrDataUrl = url;
      });
    },
  };
};

Alpine.start();
