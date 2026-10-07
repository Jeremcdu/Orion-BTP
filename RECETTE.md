# Livraison du backlog Orion BTP — 7 octobre 2026

Base analysée : `main`, commit `158003d75376a33fc277f96f729c1b8cfce4c242` du 7 octobre 2026. Le dépôt GitHub est la référence de version ; les anciennes copies jointes ont été comparées. Seules les cinq actions portant le statut « À faire » ont été traitées.

| Demande | Modification | Recette restante |
| --- | --- | --- |
| Pincement sur téléphone, M78 | Gestes Pointer Events, zoom centré entre les doigts, déplacement et suppression des clics parasites ; un appui simple conserve la sélection des réserves. | Android et iOS : pincement, déplacement, appui sur réserve et placement de repère. |
| Retour module → accueil | Préchargement au survol/focus, thème appliqué tôt, transition courte et attente des sauvegardes avant navigation. | Parcours réel depuis M42, M43 et M78 ; connexion lente et préférence de réduction des animations. |
| Page 404 | Page française autonome avec liens vers accueil et compte, compatibles avec la racine GitHub Pages `/Orion-BTP/`. | URL inconnue sur le site déployé : réponse HTTP 404 et liens fonctionnels. |
| Bouton volant compte/admin | Suppression du bouton flottant ; accès dans le menu utilisateur, administration visible selon les droits existants. | Menu sur téléphone et bureau, compte administrateur et compte ordinaire. |
| Projets enregistrés sur le compte | Projets communs aux trois modules dans Supabase, pièces jointes privées, cache par compte, migration des données locales, contrôle des versions et récupération des brouillons. | Deux navigateurs connectés au même compte : création, modification, suppression et récupération des documents/plans ; un autre compte ne voit pas les projets. |

## Vérifications exécutées

- `node tests/core.test.cjs` : **20/20 réussis**. Tests du code réel dans Node avec simulation du stockage et du transport Supabase : migration, deux appareils, fusion, conflit, collision de révision, panne réseau, modifications en file, reprise du brouillon, fichiers, changement de compte, gestes M78, attente des sauvegardes et liens 404. Le défaut tactile initial est reproduit avec l'ancien gestionnaire fourni en fixture ; ce test ne remplace pas un essai sur téléphone.
- `tests/database.test.sql` exécuté sur Supabase : **réussi**. Création, mise à jour, refus d'une révision périmée et des identifiants dupliqués, isolation entre comptes, droits sur les fichiers privés, compte désactivé et accès anonyme. Les utilisateurs et données de test ont été annulés par `ROLLBACK`.
- Vérification syntaxique des scripts et `git diff --check` : réussis.
- `tests/browser.test.cjs` : suite préparée avec transport simulé, **non exécutée**. Le navigateur Playwright n'était pas disponible et l'ouverture de l'aperçu a été interrompue. Aucune validation visuelle ou sur téléphone n'est déclarée terminée.

## État de livraison

La migration `20261007165302_orion_account_cloud_projects` a déjà été appliquée au projet Supabase **Orion BTP**, référence `mybtbrurxrtfylneresx`. Elle ajoute `orion_project_state`, l'enregistrement avec contrôle de révision et le bucket privé `orion-project-files`, sans modifier les tables existantes. `database/cloud_projects.sql` contient le SQL appliqué : ne pas le réexécuter sur ce projet.

Le code complet est livré dans l'archive `Orion-BTP-backlog-2026-10-07.zip` de cette conversation. La connexion GitHub a refusé la création d'un fichier avec `403 Resource not accessible by integration` : aucune branche ou pull request n'a pu être créée. Le dépôt et le site public restent sur leur version actuelle ; l'intégration et la publication du code restent à effectuer avec un accès en écriture. Les cinq fiches Notion sont proposées au statut « À tester », avec leurs résultats et les essais restants. Les autres actions du backlog sont conservées.

L'archive contient le dossier complet `Orion-BTP/` et un patch `Orion-BTP-backlog.patch`. Pour intégrer les seules modifications, extraire le patch puis, dans un clone propre à la version de référence, créer une branche et contrôler l'application avant de l'appliquer :

```sh
git switch -c backlog-orion-btp-2026-10-07
git apply --check /chemin/Orion-BTP-backlog.patch
git apply /chemin/Orion-BTP-backlog.patch
```

Les fichiers de l'archive et du patch contiennent les mêmes modifications. Si `main` a évolué, adapter les changements sur la nouvelle base avant publication. La migration serveur déjà appliquée ne doit pas être relancée.

La première ouverture authentifiée récupère les projets du serveur et importe les données locales propres à ce compte. Des changements incompatibles sont bloqués avec conservation du brouillon ; il faut l'exporter avant de recharger. L'export de secours contient les données des projets ; la sauvegarde complète existante reste nécessaire pour emporter les pièces jointes. Les fichiers sont immuables et privés ; leur nettoyage serveur après suppression des références reste un travail ultérieur.

## Relancer les vérifications

Les tests principaux demandent Node.js 20 ou supérieur et n'ajoutent aucune dépendance :

```sh
node tests/core.test.cjs
```

Pour la suite navigateur, installer Playwright et son navigateur Chromium dans un environnement de développement. Depuis un clone Git complet, préparer aussi la version de référence :

```sh
mkdir -p ../qa-baseline
git archive 158003d75376a33fc277f96f729c1b8cfce4c242 | tar -x -C ../qa-baseline
node tests/browser.test.cjs
```

Cette suite utilise un serveur de test et des comptes fictifs ; elle ne vérifie pas une connexion réelle à Supabase. Le script SQL teste les droits de la base dans une transaction annulée et doit être lancé par un accès administrateur autorisé sur un environnement disposant de la migration.
