# Modèle de carte Apple Wallet

`icon.png` / `icon@2x.png` / `logo.png` / `logo@2x.png` sont des **placeholders 1x1 transparents** — à remplacer avant toute mise en production par de vraies images :

- `icon.png` : 29×29px (58×58 pour `@2x`) — icône affichée dans les notifications et Apple Watch.
- `logo.png` : 160×50px max (320×100 pour `@2x`) — logo affiché en haut de la carte.

`pass.json` ici ne contient que le strict nécessaire (`backFields` avec les conditions d'utilisation) — tous les autres champs (`serialNumber`, `organizationName`, `primaryFields` avec le nombre de tampons, `backgroundColor`, etc.) sont injectés dynamiquement par `src/buildPass.ts` à partir des données réelles du commerce/client en base.
