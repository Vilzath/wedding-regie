# Régie mariage

Application Angular mobile-first pour piloter les musiques d’une cérémonie depuis un téléphone relié en Bluetooth à la sonorisation.

Stack validée : Angular 21.2, TypeScript 5.9 et Node.js 20.19+.

## Ce que fait la V0.3

- écran **Musiques** organisé par catégories ;
- un seul morceau lu à la fois, avec pause, reprise, arrêt et position ;
- écran **Conducteur** : toute balise comme `@entree` devient un bouton musical dans le texte ;
- extraits minutés dans le conducteur avec une balise comme `@entree[0:30-1:15]` ;
- fondu descendant sur les deux dernières secondes d’un morceau ou d’un extrait, et fondu court lors d’un changement de musique ;
- mode boucle activable par l’administrateur dans le lecteur, pour un morceau entier ou uniquement l’extrait minuté ;
- écran **Administration** : catégories, boutons, descriptions, images, audios et conducteur ;
- rôles `ADMIN` et `USER` ;
- maintien de l’écran allumé via la Screen Wake Lock API ;
- déduplication des fichiers audio par SHA-256 ;
- suppression automatique des médias qui ne sont plus utilisés par aucun bouton ;
- mise à jour des balises dans le conducteur lors d’un renommage, suppression lors d’un effacement ;
- normalisation automatique des balises saisies avec espaces, accents ou majuscules ;
- messages visibles lorsqu’un champ empêche une sauvegarde ;
- remise à zéro fiable des sélecteurs de fichiers pour pouvoir réutiliser la même musique ;
- tests des routes d’enregistrement, du minutage, du fondu et de la boucle.

Les anciennes balises sans minutage restent compatibles. Dans l’éditeur du conducteur, sélectionner une musique permet de choisir entre le morceau entier et un extrait avec un début et une fin. Le lecteur affiche ensuite la plage réellement jouée.

Le Bluetooth reste géré par le téléphone : l’application lit simplement le son sur la sortie audio active du mobile.

## Développement local

Prérequis : Node.js 20.19+ (dont `20.20.2`) et Docker.

```bash
cp .env.development.example .env.development
docker compose -f compose.local.yml up -d db
npm ci
npm run dev
```

`npm run dev` génère automatiquement le client Prisma et applique les migrations avant de lancer l’API et Angular.
Le message `.env.development not found` est sans gravité si le fichier n’a pas encore été copié : les valeurs locales par défaut restent utilisables.

L’interface est disponible sur `http://localhost:4200`.

Comptes de développement :

- administrateur : `admin` / `admin`
- utilisateur : `user` / `user`

Le serveur recrée ou resynchronise ces deux comptes depuis les variables d’environnement à chaque démarrage.

## Vérifications

```bash
npm run check
```

Cette commande valide Prisma, vérifie TypeScript, lance les tests puis produit les builds Angular et serveur.

## Production sur le VPS

Le conteneur applicatif rejoint les réseaux Docker externes `web` et `database`. Il n’embarque aucun PostgreSQL et n’expose aucun port public.

1. Créer `/opt/docker/apps/wedding-music` sur le VPS.
2. Y placer `compose.yml`, créer `.env` depuis `.env.example`, puis créer le dossier `data`.
3. Créer une fois le rôle et le schéma avec `deploy/postgres-bootstrap.sql` en remplaçant son mot de passe.
4. Ajouter le bloc de `deploy/Caddyfile.example` au Caddy général avec le vrai domaine.
5. Connecter le VPS à GHCR, puis lancer :

```bash
docker compose pull wedding-music
docker compose up -d --force-recreate wedding-music
docker compose ps
docker logs --tail 200 -f wedding-music
```

Au démarrage, le conteneur applique `prisma migrate deploy`, synchronise les deux comptes depuis `.env`, puis lance l’application sous un utilisateur non privilégié.

## Stockage

Les fichiers sont stockés dans `/app/data` à l’intérieur du conteneur, monté sur `./data` côté VPS. La base PostgreSQL ne contient que leurs métadonnées et leur empreinte.

Sauvegarder ensemble le schéma PostgreSQL `wedding_music` et le dossier `data`.
