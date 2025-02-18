
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
const PORT = 3002;

app.use(cors({
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'clé_secrète_temporaire';
const uri = process.env.MONGODB_URI || "mongodb+srv://theligener15:admin@cluster0.e217n.mongodb.net/?retryWrites=true&w=majority";

const client = new MongoClient(uri);
let messagesCollection;
let usersCollection;

async function connectDB() {
    try {
        await client.connect();
        const contentDB = client.db("content");
        const adminDB = client.db("administration");
        messagesCollection = contentDB.collection("messages");
        usersCollection = adminDB.collection("users");
        console.log("Connecté à la base de données MongoDB");
    } catch (error) {
        console.error("Erreur de connexion à la base de données", error);
    }
}

connectDB();

const checkAuth = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ message: 'Non autorisé' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Token invalide' });
    }
};

// Créer un message
app.post('/newMessage', checkAuth, async (req, res) => {
    try {
        const { title, text } = req.body;
        const user = await usersCollection.findOne({ _id: new ObjectId(req.user.userId) });

        if (!title || !text) {
            return res.status(400).json({ message: 'Titre et contenu requis' });
        }

        const newMessage = {
            title,
            text,
            userId: req.user.userId,
            user: user.username,
            createdAt: new Date(),
            likes: 0,
            dislikes: 0,
            answers: []
        };
        
        const result = await messagesCollection.insertOne(newMessage);
        
        res.status(201).json({ 
            message: newMessage, 
            id: result.insertedId 
        });
    } catch (err) {
        res.status(500).json({ message: 'Erreur de création de message' });
    }
});

// // Récupérer les messages avec pagination et recherche
// app.get('/messages', async (req, res) => {
//     try {
//         const { search, page = 1 } = req.query;
//         const limit = 10;
//         const skip = (page - 1) * limit;

//         let query = {};
//         if (search) {
//             query = {
//                 $or: [
//                     { title: { $regex: search, $options: 'i' } },
//                     { text: { $regex: search, $options: 'i' } }
//                 ]
//             };
//         }
        
//         const messages = await messagesCollection
//             .find(query)
//             .sort({ createdAt: -1 })
//             .skip(skip)
//             .limit(limit)
//             .toArray();
        
//         res.status(200).json(messages);
//     } catch (err) {
//         res.status(500).json({ message: 'Erreur de récupération des messages' });
//     }
// });
app.get('/messages', async (req, res) => {
    try {
        const { search, page = 1 } = req.query;
        const limit = 10;
        const skip = (page - 1) * limit;

        let query = {};
        if (search) {
            query = {
                $or: [
                    { title: { $regex: search, $options: 'i' } },
                    { text: { $regex: search, $options: 'i' } }
                ]
            };
        }
        
        const messages = await messagesCollection
            .find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();
        
        // Tronquer les messages à 250 caractères
        const processedMessages = messages.map(message => ({
            ...message,
            text: message.text.length > 250 
                ? message.text.substring(0, 250) + '...'
                : message.text
        }));
        
        res.status(200).json(processedMessages);
    } catch (err) {
        res.status(500).json({ message: 'Erreur de récupération des messages' });
    }
});

// Voter sur un message
app.post('/message/:messageId/vote', checkAuth, async (req, res) => {
    try {
        const { type } = req.body;
        const messageId = new ObjectId(req.params.messageId);

        if (!['like', 'dislike'].includes(type)) {
            return res.status(400).json({ message: 'Type de vote invalide' });
        }

        const updateOperation = type === 'like' 
            ? { $inc: { likes: 1 } }
            : { $inc: { dislikes: 1 } };
        
        await messagesCollection.updateOne(
            { _id: messageId },
            updateOperation
        );
        
        res.status(200).json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ message: 'Erreur de vote' });
    }
});

// Supprimer un message (réservé aux administrateurs)
app.delete('/message/:messageId', checkAuth, async (req, res) => {
    try {
        const user = await usersCollection.findOne({ _id: new ObjectId(req.user.userId) });
        
        if (user.profil !== 'admin') {
            return res.status(403).json({ message: 'Non autorisé' });
        }

        const result = await messagesCollection.deleteOne({ 
            _id: new ObjectId(req.params.messageId) 
        });
        
        res.status(200).json({ 
            message: 'Message supprimé', 
            deletedCount: result.deletedCount 
        });
    } catch (err) {
        res.status(500).json({ message: 'Erreur de suppression de message' });
    }
});

// Récupérer les messages de l'utilisateur
app.get('/user-messages', checkAuth, async (req, res) => {
    try {
        const messages = await messagesCollection
            .find({ userId: req.user.userId })
            .sort({ createdAt: -1 })
            .toArray();
        
        res.status(200).json(messages);
    } catch (err) {
        res.status(500).json({ message: 'Erreur de récupération des messages' });
    }
});

// Route pour ajouter une réponse à un message
app.post('/message/:messageId/answer', checkAuth, async (req, res) => {
    try {
        const response = await fetch(`${MESSAGE_SERVICE}/message/${req.params.messageId}/answer`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': req.headers['authorization']
            },
            body: JSON.stringify(req.body)
        });
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (error) {
        res.status(500).json({ message: 'Erreur d\'ajout de réponse' });
    }
});


// Ajouter une réponse à un message
app.post('/message/:messageId/answer', checkAuth, async (req, res) => {
    try {
        const { text } = req.body;
        const messageId = new ObjectId(req.params.messageId);
        const user = await usersCollection.findOne({ _id: new ObjectId(req.user.userId) });

        if (!text) {
            return res.status(400).json({ message: 'Contenu de la réponse requis' });
        }

        const newAnswer = {
            userId: req.user.userId,
            username: user.username,
            text: text.length > 250 ? text.substring(0, 250) : text,
            createdAt: new Date()
        };

        const result = await messagesCollection.updateOne(
            { _id: messageId },
            { $push: { answers: newAnswer } }
        );

        res.status(201).json({ message: 'Réponse ajoutée', answer: newAnswer });
    } catch (err) {
        res.status(500).json({ message: 'Erreur d\'ajout de réponse' });
    }
});

// Modifier la route des messages pour inclure le nombre de réponses
app.get('/messages', async (req, res) => {
    try {
        const { search, page = 1 } = req.query;
        const limit = 10;
        const skip = (page - 1) * limit;

        let query = {};
        if (search) {
            query = {
                $or: [
                    { title: { $regex: search, $options: 'i' } },
                    { text: { $regex: search, $options: 'i' } }
                ]
            };
        }
        
        const messages = await messagesCollection
            .find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();
        
        // Ajouter le nombre de réponses et tronquer les messages
        const processedMessages = messages.map(message => ({
            ...message,
            text: message.text.length > 250 
                ? message.text.substring(0, 250) + '...'
                : message.text,
            answersCount: message.answers ? message.answers.length : 0
        }));
        
        res.status(200).json(processedMessages);
    } catch (err) {
        res.status(500).json({ message: 'Erreur de récupération des messages' });
    }
});

// Récupérer les réponses d'un message
app.get('/message/:messageId/answers', async (req, res) => {
    try {
        const messageId = new ObjectId(req.params.messageId);
        const message = await messagesCollection.findOne({ _id: messageId });

        if (!message) {
            return res.status(404).json({ message: 'Message non trouvé' });
        }

        // Limiter à 10 réponses, tronquer à 250 caractères
        const answers = (message.answers || [])
            .slice(0, 10)
            .map(answer => ({
                ...answer,
                text: answer.text.length > 250 
                    ? answer.text.substring(0, 250) + '...' 
                    : answer.text
            }));

        res.status(200).json(answers);
    } catch (err) {
        res.status(500).json({ message: 'Erreur de récupération des réponses' });
    }
});

app.listen(PORT, () => console.log(`Service de messages sur http://localhost:${PORT}`));