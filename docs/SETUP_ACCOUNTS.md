# Guide de création des comptes — Arnakit

Ce guide couvre les 4 comptes externes nécessaires pour rendre le produit réellement opérationnel. Le code de la Phase 0-4 fonctionne déjà sans eux (schéma, dashboard, structure des fonctions), mais chaque section ci-dessous débloque une brique réelle (vraie carte Apple/Google, vrais prélèvements).

Ordre recommandé : **1 → 2 → 3 → 4** (le statut עוסק de l'étape 1 est un prérequis pour l'étape 4 seulement — tu peux faire 2 et 3 en parallèle dès maintenant, sans attendre).

---

## 1. Enregistrement עוסק (obligatoire avant de facturer réellement quelqu'un)

Nécessaire uniquement pour ouvrir un vrai compte marchand Cardcom (étape 4) et pour émettre des חשבוניות légales. Pas nécessaire pour Apple Developer Individual ni Google Wallet.

1. Va sur le site du **מס הכנסה** (`gov.il` → "פתיחת תיק עוסק"), ou passe par un רואה חשבון si tu préfères déléguer.
2. Choisis **עוסק פטור** si ton chiffre d'affaires prévu est sous le seuil annuel (~₪120,000 en 2026, à vérifier au moment de l'inscription) — pas de TVA à collecter, le plus simple pour démarrer. Choisis **עוסק מורשה** si tu prévois de dépasser ce seuil rapidement.
3. Ouvre aussi un תיק ניכויים / ביטוח לאומי (Bituach Leumi) — généralement fait dans la même démarche.
4. Délai : souvent traité en 1-3 jours ouvrés. Coût : gratuit pour l'ouverture elle-même.
5. Une fois le numéro עוסק obtenu, garde-le sous la main pour l'étape 4.

---

## 2. Apple Developer Program — Individual

Débloque la signature réelle des cartes `.pkpass` (Phase 1).

1. Va sur **developer.apple.com/programs** → *Enroll*, connecte-toi avec un Apple ID personnel (ou crées-en un dédié au projet).
2. Choisis **Individual** (pas besoin de DUNS ni d'entité légale — utilisable dès maintenant même sans עוסק). Tu pourras upgrader vers *Organization* plus tard si besoin (facturation au nom de la société, plusieurs comptes équipe).
3. Paye les **99$/an**.
4. Une fois approuvé (souvent en quelques heures, parfois 24-48h), va dans **Certificates, Identifiers & Profiles** :
   - **Identifiers → Pass Type IDs → +** : crée un identifiant du style `pass.co.il.arnakit.loyalty`. Note-le, c'est la valeur à mettre dans `loyalty_cards.apple_pass_type_id`.
   - Clique sur ce Pass Type ID → **Create Certificate** → suis les instructions pour générer une CSR depuis *Trousseau d'accès* (Keychain Access, sur un Mac — si tu n'as pas de Mac, dis-le-moi, il y a une méthode via `openssl` sur Windows) → télécharge le certificat `.cer` généré par Apple.
5. Télécharge aussi le certificat **Apple WWDR (Worldwide Developer Relations)** depuis `developer.apple.com/certificationauthority/AppleWWDRCAG4.cer` (ou la version en cours indiquée sur cette page).
6. Convertis le certificat + ta clé privée en un fichier `.p12` (mot de passe à choisir) — nécessaire pour `passkit-generator`. Donne-moi le `.cer`, la clé privée exportée, et le WWDR quand tu les as ; je t'aiderai à faire la conversion `.p12` si tu n'as pas de Mac sous la main.
7. **Clé APNs** (pour les mises à jour live de la carte, pas juste l'installation) : dans le portail développeur, **Keys → +**, coche *Apple Push Notifications service (APNs)*, télécharge le fichier `.p8` — **il n'est téléchargeable qu'une seule fois**, garde-le précieusement. Note aussi le *Key ID* affiché et ton *Team ID* (visible en haut à droite du portail).

Ce qu'il me faut ensuite de ta part : le `.p12` (cert + clé), le WWDR `.cer`, le `.p8` APNs, le Key ID, le Team ID, et le Pass Type ID exact.

---

## 3. Google Wallet API — compte Issuer

Débloque la carte Google Wallet (Phase 2). Pas besoin d'entité légale, gratuit.

1. Va sur **pay.google.com/business/console** et connecte-toi avec un compte Google (perso ou dédié projet).
2. Demande l'accès à **Google Wallet API** si ce n'est pas déjà activé — un formulaire de validation peut être demandé (nom du business, cas d'usage : "digital loyalty card"), généralement validé en quelques jours.
3. Une fois approuvé, tu obtiens un **Issuer ID** (numérique) — note-le.
4. Va sur **console.cloud.google.com**, crée un projet (ou réutilise le projet Supabase existant si tu en as un lié à Google Cloud), puis **APIs & Services → Credentials → Create Credentials → Service Account**.
5. Donne un nom au service account, rôle *Wallet Object Issuer* (ou équivalent le plus restreint proposé), puis **Keys → Add Key → JSON** — télécharge le fichier `.json` contenant la clé privée du service account.
6. Dans la Google Pay & Wallet Console, ajoute l'adresse email du service account (visible dans le `.json`, champ `client_email`) comme utilisateur autorisé de ton compte Issuer.

Ce qu'il me faut ensuite : l'Issuer ID et le fichier `.json` du service account.

---

## 4. Cardcom — facturation récurrente

**Sandbox utilisable dès maintenant** (pas besoin d'attendre l'עוסק) pour tester le flux de bout en bout. Le compte marchand réel (vrais prélèvements) attend ton numéro עוסק de l'étape 1.

1. Va sur **cardcom.solutions** (ou le site actuel de Cardcom) → *הרשמה* / inscription.
2. Demande l'accès à un **terminal de test (sandbox)** — généralement fourni immédiatement ou sous 24h, avec des numéros de carte de test pour simuler les paiements.
3. Dans l'espace *הגדרות → מסופים / API*, récupère ton **numéro de terminal (TerminalNumber)** et ton **API Name / API Password** (ou "UserName" selon la version de leur API) — c'est ce qui authentifie nos appels serveur.
4. Active la fonctionnalité **LowProfile / Iframe tokenization** (le nom exact varie) — c'est ce qui permet au commerçant d'entrer sa carte sur une page hébergée par Cardcom, sans que ses données ne transitent jamais par nos serveurs.
5. Configure l'URL de **webhook / callback** vers `https://<ton-projet>.supabase.co/functions/v1/cardcom-webhook` (on la branchera ensemble une fois le sandbox actif).
6. Quand ton עוסק est actif : demande l'upgrade vers un **compte marchand réel** (généralement un formulaire + pièce d'identité + RIB + numéro עוסק), et active la génération automatique de חשבוניות.

Ce qu'il me faut ensuite : le numéro de terminal sandbox, l'API Name/Password sandbox (puis les équivalents réels une fois le compte marchand actif).

---

## Une fois que tu as des identifiants

Ne me les envoie jamais en clair dans le chat s'ils sont sensibles (clé privée `.p12`, `.p8`, JSON service account, mots de passe API) — on les mettra directement dans les **secrets Supabase** (`supabase secrets set ...`) ou les variables d'environnement du service Node, jamais commités dans le repo Git.
