Depuis la racine du paquet (qui contient package.json), avec Node.js 22 ou ultérieur :

```sh
npm install
npm test
```

Aucune clé Supabase ni donnée réelle n’est nécessaire. Le test SQL utilise les rôles anon/authenticated et la migration exacte. Le test interface charge les pages livrées avec un service simulé. Le processus jsdom se termine explicitement après vérification pour libérer les observateurs et minuteurs de contrôle d’accès.
