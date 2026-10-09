const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 3000;

const stripe = require('stripe')(process.env.PAYMENT_SECRET || 'sk_test_placeholder');
const crypto = require('crypto');
const admin = require('firebase-admin');

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString(
    'utf8'
);
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

// Order ID generator
function generateOrderId() {
    const prefix = 'AURA'; 
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const random = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `${prefix}-${date}-${random}`;
}

// middleware
app.use(cors());
app.use(express.json());

const verifyFBToken = async (req, res, next) => {
    const token = req.headers.authorization;
    if (!token) {
        return res.status(401).send({ message: 'unauthorized access' });
    }
    try {
        const idToken = token.split(' ')[1];
        const decoded = await admin.auth().verifyIdToken(idToken);
        req.decoded_email = decoded.email;
        next();
    } catch (err) {
        return res.status(401).send({ message: 'unauthorized access' });
    }
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.qennq9r.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
});

async function run() {
    try {
        const db = client.db('Loan_link_db');
        const productCollection = db.collection('loans'); 
        const orderCollection = db.collection('orders'); 
        const userCollection = db.collection('users');
        const paymentCollection = db.collection('payments');

        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded_email;
            const query = { email };
            const user = await userCollection.findOne(query);
            if (!user || user.role !== 'Admin') {
                return res.status(403).send({ message: 'Forbidden Access' });
            }
            next();
        };

        const verifyManager = async (req, res, next) => {
            const email = req.decoded_email;
            const query = { email };
            const user = await userCollection.findOne(query);
            if (!user || user.role !== 'Manager') {
                return res.status(403).send({ message: 'Forbidden Access' });
            }
            next();
        };

        const verifyAdminManager = async (req, res, next) => {
            const email = req.decoded_email;
            const query = { email };
            const user = await userCollection.findOne(query);
            if (!user || (user.role !== 'Admin' && user.role !== 'Manager')) {
                return res.status(403).send({ message: 'Forbidden Access' });
            }
            next();
        };

        // --- PRODUCT API'S ---
        app.get('/all-loans', async (req, res) => {
            const cursor = productCollection.find({});
            const result = await cursor.toArray();
            res.send(result);
        });

        app.get('/six-loans', async (req, res) => {
            const cursor = productCollection
                .find({})
                .limit(6)
                .sort({ createdAt: -1 });
            const result = await cursor.toArray();
            res.send(result);
        });

        app.get('/all-loans/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await productCollection.findOne(query);
            res.send(result);
        });

        // Admin & Manager endpoint to view all products with optional filters
        app.get('/all-loans-admin', verifyFBToken, verifyAdminManager, async (req, res) => {
            const { email, searchText } = req.query;
            let query = {};
            
            if (email) {
                query.createdBy = email;
            }
            
            if (searchText && searchText.trim() !== '') {
                query.$or = [
                    { title: { $regex: searchText,$options: 'i' } },
                    { category: { $regex: searchText,$options: 'i' } }
                ];
            }

            const result = await productCollection.find(query).toArray();
            res.send(result);
        });

        app.post('/all-loans', verifyFBToken, verifyManager, async (req, res) => {
            const newProduct = req.body;
            const email = req.query.email;
            newProduct.createdAt = new Date();
            newProduct.createdBy = email;
            const result = await productCollection.insertOne(newProduct);
            res.send(result);
        });

        app.delete('/all-loans/:id', verifyFBToken, verifyAdminManager, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await productCollection.deleteOne(query);
            res.send(result);
        });

        app.patch('/all-loans/:id', verifyFBToken, verifyAdminManager, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const updatedFields = req.body;
            const update = {
                $set: updatedFields
            };
            const result = await productCollection.updateOne(query, update);
            res.send(result);
        });

        // --- ORDER & ADMIN ORDERS API'S ---
        app.get('/orders', verifyFBToken, async (req, res) => {
            const query = {};
            const email = req.query.email;
            if (email) {
                query.email = email;
                if (email !== req.decoded_email) {
                    return res.status(403).send({ message: 'forbidden access' });
                }
            }
            const result = await orderCollection
                .find(query)
                .sort({ createdAt: -1 })
                .toArray();
            res.send(result);
        });

        // Admin endpoint to view all customer orders
        app.get('/all-orders', verifyFBToken, verifyAdminManager, async (req, res) => {
            const result = await orderCollection.find().sort({ createdAt: -1 }).toArray();
            res.send(result);
        });

        app.post('/loan-application', verifyFBToken, async (req, res) => {
            const orderData = req.body;
            const orderTrackingId = generateOrderId();
            orderData.createdAt = new Date();
            orderData.orderTrackingId = orderTrackingId;
            orderData.paymentStatus = 'pending';

            const result = await orderCollection.insertOne(orderData);
            res.send(result);
        });

        app.post('/orders', verifyFBToken, async (req, res) => {
            const orderData = req.body;
            const orderTrackingId = generateOrderId();
            orderData.createdAt = new Date();
            orderData.orderTrackingId = orderTrackingId;
            orderData.paymentStatus = 'pending';

            const result = await orderCollection.insertOne(orderData);
            res.send(result);
        });

        app.patch('/orders/:id', verifyFBToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const updatedStatus = req.body;
            const update = {
                $set: {
                    orderStatus: updatedStatus.orderStatus,
                },
            };
            const result = await orderCollection.updateOne(query, update);
            res.send(result);
        });

        // --- STRIPE PAYMENT API'S ---
        app.post('/create-checkout-session', async (req, res) => {
            const paymentInfo = req.body;
            const amount = parseInt(paymentInfo.totalAmount) * 100;
            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        price_data: {
                            currency: 'usd',
                            unit_amount: amount,
                            product_data: {
                                name: `Purchase: ${paymentInfo.productTitle}`,
                            },
                        },
                        quantity: 1,
                    },
                ],
                mode: 'payment',
                metadata: {
                    orderId: paymentInfo.orderId,
                    order_tracking_id: paymentInfo.orderTrackingId,
                },
                customer_email: paymentInfo.email,
                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancel?`,
            });
            res.send({ url: session.url });
        });

        app.patch('/verified-payment-success', async (req, res) => {
            const sessionId = req.query.session_id;
            const session = await stripe.checkout.sessions.retrieve(sessionId);
            const transactionId = session.payment_intent;
            const query = { transactionId: transactionId };
            const paymentExist = await paymentCollection.findOne(query);
            if (paymentExist) {
                return res.send({ message: 'already exist', transactionId });
            }
            if (session.payment_status === 'paid') {
                const id = session.metadata.orderId;
                const query = { _id: new ObjectId(id) };
                const update = {
                    $set: {
                        paymentStatus: 'paid',
                        transactionId: session.payment_intent,
                        paidAt: new Date(),
                    },
                };
                const result = await orderCollection.updateOne(query, update);
                const payment = {
                    amount: session.amount_total / 100,
                    transactionId: session.payment_intent,
                    paymentStatus: session.payment_status,
                    customerEmail: session.customer_email,
                    orderTrackingId: session.metadata.order_tracking_id,
                    paidAt: new Date(),
                };
                const paymentResult = await paymentCollection.insertOne(payment);
                return res.send({
                    success: true,
                    paymentInfo: paymentResult,
                    orderID: session.metadata.order_tracking_id,
                    transactionId: session.payment_intent,
                });
            }
            res.send({ success: false });
        });

        // --- USER API'S ---
        app.post('/users', async (req, res) => {
            const newUser = req.body;
            newUser.role = 'Customer';
            newUser.createdAt = new Date();
            const email = newUser.email;

            const userExist = await userCollection.findOne({ email });
            if (userExist) {
                return res.send('user already exist');
            }
            const result = await userCollection.insertOne(newUser);
            res.send(result);
        });

        app.get('/users', verifyFBToken, async (req, res) => {
            const email = req.query.email;
            const role = req.query.role;
            const query = {};
            if (email) query.email = email;
            if (role) query.role = role;

            const result = await userCollection.find(query).toArray();
            res.send(result);
        });

        app.get('/users/:email/role', async (req, res) => {
            const email = req.params.email;
            const query = { email };
            const user = await userCollection.findOne(query);
            res.send({ role: user?.role || 'Customer' });
        });

        app.patch('/users/:id', async (req, res) => {
            const role = req.body.role;
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const updatedRole = { $set: { role: role } };
            const result = await userCollection.updateOne(query, updatedRole);
            res.send(result);
        });

        await client.db('admin').command({ ping: 1 });
        console.log('Pinged your deployment. You successfully connected to MongoDB!');
    } finally {
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Aura store server is running smoothly');
});

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});