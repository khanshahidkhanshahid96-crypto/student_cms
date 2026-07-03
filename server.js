const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');

// 1. Env check
if (!process.env.MONGODB_URI) {
    console.error("FATAL ERROR: MONGODB_URI environment variable is missing.");
    console.error("Please set it in your Render.com environment variables before deploying.");
    process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public')); 
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(session({
    secret: 'secret_key_cms',
    resave: false,
    saveUninitialized: true
}));

// Mongoose Models
const CourseSchema = new mongoose.Schema({ name: String });
const Course = mongoose.model('Course', CourseSchema);

const SubjectSchema = new mongoose.Schema({ name: String, course_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' } });
const Subject = mongoose.model('Subject', SubjectSchema);

const UserSchema = new mongoose.Schema({
    full_name: String,
    email: String,
    password: { type: String, default: '123456' },
    role: { type: String, enum: ['admin', 'staff', 'student'] },
    gender: String,
    address: String,
    profile_pic: { type: String, default: 'default.png' },
    course_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
    session_id: String
});
const User = mongoose.model('User', UserSchema);

const AttendanceSchema = new mongoose.Schema({
    student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    subject_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject' },
    course_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
    status: String,
    date: String
});
const Attendance = mongoose.model('Attendance', AttendanceSchema);

const ScoreSchema = new mongoose.Schema({
    student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    subject_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject' },
    score: Number
});
const Score = mongoose.model('Score', ScoreSchema);

const LeaveSchema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    role: String,
    date: String,
    message: String,
    status: { type: String, default: 'Pending' },
    created_at: { type: Date, default: Date.now }
});
const Leave = mongoose.model('Leave', LeaveSchema);

const NotificationSchema = new mongoose.Schema({
    message: String,
    type: String,
    created_at: { type: Date, default: Date.now }
});
const Notification = mongoose.model('Notification', NotificationSchema);

const FeedbackSchema = new mongoose.Schema({
    student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    message: String,
    created_at: { type: Date, default: Date.now }
});
const Feedback = mongoose.model('Feedback', FeedbackSchema);

// DB Connection & Admin Init
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(async () => {
        console.log("Connected to MongoDB.");
        await initAdmin();
    }).catch(err => console.error(err));

async function initAdmin() {
    const adminExists = await User.findOne({ role: 'admin' });
    if (!adminExists) {
        await User.create({
            email: 'admin',
            password: '123456',
            role: 'admin',
            full_name: 'Administrator'
        });
        console.log("Default admin created.");
    }
}

// Auth Middleware
function requireAuth(req, res, next) {
    if (!req.session.user) return res.redirect('/login');
    next();
}

// Routes
app.get('/', (req, res) => res.redirect('/app'));

app.get('/login', (req, res) => {
    res.render('login', { error: req.query.error });
});

app.post('/login', async (req, res) => {
    try {
        const user = await User.findOne({ email: req.body.email, password: req.body.password });
        if (user) {
            req.session.user = user;
            res.redirect('/app?page=dashboard');
        } else {
            res.redirect('/login?error=Invalid credentials');
        }
    } catch (err) {
        res.redirect('/login?error=Database Error');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// Single shared handler for GET/POST /app
async function appHandler(req, res) {
    try {
        const user = req.session.user;
        const page = req.query.page || 'dashboard';
        let success_msg = req.query.msg || '';

        // 2. Handle Deletion
        if (req.method === 'GET' && req.query.delete === '1' && req.query.table && req.query.id) {
            const { table, id } = req.query;
            if (table === 'courses') await Course.findByIdAndDelete(id);
            else if (table === 'subjects') await Subject.findByIdAndDelete(id);
            else if (table === 'staff' || table === 'students') await User.findByIdAndDelete(id);
            return res.redirect(`/app?page=${page}&msg=Record deleted successfully.`);
        }

        // 3. Handle POST actions
        if (req.method === 'POST') {
            const action = req.body.action;
            switch (action) {
                case 'add_course':
                    await Course.create({ name: req.body.name });
                    success_msg = 'Course added successfully.';
                    break;
                case 'add_subject':
                    await Subject.create({ name: req.body.name, course_id: req.body.course_id });
                    success_msg = 'Subject added successfully.';
                    break;
                case 'add_staff':
                    await User.create({ ...req.body, role: 'staff' });
                    success_msg = 'Staff added successfully.';
                    break;
                case 'add_student':
                    await User.create({ ...req.body, role: 'student' });
                    success_msg = 'Student added successfully.';
                    break;
                case 'save_attendance':
                    const { date, course_id, subject_id, attendance } = req.body;
                    await Attendance.deleteMany({ date, course_id, subject_id });
                    if (attendance) {
                        for (const [student_id, status] of Object.entries(attendance)) {
                            await Attendance.create({ student_id, subject_id, course_id, status, date });
                        }
                    }
                    success_msg = 'Attendance saved successfully.';
                    break;
                case 'save_scores':
                    const { subject_id: s_id, score } = req.body;
                    if (score) {
                        for (const [student_id, val] of Object.entries(score)) {
                            if (val !== '') {
                                await Score.findOneAndUpdate(
                                    { student_id, subject_id: s_id },
                                    { score: Number(val) },
                                    { upsert: true, new: true }
                                );
                            }
                        }
                    }
                    success_msg = 'Scores saved successfully.';
                    break;
                case 'apply_leave':
                    await Leave.create({ user_id: user._id, role: user.role, date: req.body.date, message: req.body.message });
                    success_msg = 'Leave applied successfully.';
                    break;
                case 'update_leave':
                    await Leave.findByIdAndUpdate(req.body.leave_id, { status: req.body.status });
                    success_msg = 'Leave updated successfully.';
                    break;
                case 'send_notification':
                    await Notification.create({ message: req.body.message, type: req.body.type });
                    success_msg = 'Notification sent successfully.';
                    break;
                case 'send_feedback':
                    await Feedback.create({ student_id: user._id, message: req.body.message });
                    success_msg = 'Feedback submitted successfully.';
                    break;
            }
            return res.redirect(`/app?page=${page}&msg=${success_msg}`);
        }

        // 4. Prepare data object
        let data = {
            user, page, success_msg,
            fetched_students: [], exam_students: [], existing_scores: {}, existing_attendance: {},
            fetch_date: req.query.fetch_date || '',
            fetch_course: req.query.fetch_course || '',
            fetch_subject: req.query.fetch_subject || ''
        };

        // 5. Always fetch
        data.courses = await Course.find();
        data.subjects = await Subject.find().populate('course_id');

        // 6. Page-specific fetching
        if (page === 'dashboard') {
            data.total_students = await User.countDocuments({ role: 'student' });
            data.total_staff = await User.countDocuments({ role: 'staff' });
            data.total_courses = await Course.countDocuments();
            data.total_subjects = await Subject.countDocuments();
            data.att_count = await Attendance.countDocuments();
            if (user.role === 'student') {
                data.total_present = await Attendance.countDocuments({ student_id: user._id, status: 'Present' });
                data.total_total = await Attendance.countDocuments({ student_id: user._id });
            }
        } else if (page === 'manage_staff') {
            data.staffs = await User.find({ role: 'staff' });
        } else if (page === 'manage_students') {
            data.students = await User.find({ role: 'student' }).populate('course_id');
        } else if (page === 'manage_attendance' || page === 'take_attendance') {
            if (data.fetch_course && data.fetch_date && data.fetch_subject) {
                data.fetched_students = await User.find({ role: 'student', course_id: data.fetch_course });
                const attList = await Attendance.find({ date: data.fetch_date, subject_id: data.fetch_subject });
                attList.forEach(a => data.existing_attendance[a.student_id] = a.status);
            }
        } else if (page === 'manage_exams') {
            if (data.fetch_course && data.fetch_subject) {
                data.fetched_students = await User.find({ role: 'student', course_id: data.fetch_course });
                const scoreList = await Score.find({ subject_id: data.fetch_subject });
                scoreList.forEach(s => data.existing_scores[s.student_id] = s.score);
            }
        } else if (page === 'notifications') {
            data.leaves = await Leave.find().populate('user_id').sort({ created_at: -1 });
        } else if (page === 'staff_notifs') {
            data.notifs = await Notification.find({ type: 'staff' }).sort({ created_at: -1 });
        } else if (page === 'student_notifs') {
            data.notifs = await Notification.find({ type: 'student' }).sort({ created_at: -1 });
        } else if (page === 'apply_leave') {
            data.my_leaves = await Leave.find({ user_id: user._id }).sort({ created_at: -1 });
        } else if (page === 'view_attendance') {
            data.logs = await Attendance.find().populate('student_id subject_id').sort({ date: -1 }).limit(50);
        } else if (page === 'my_attendance') {
            data.my_att = await Attendance.find({ student_id: user._id }).populate('subject_id').sort({ date: -1 });
        } else if (page === 'exam_results') {
            data.scores = await Score.find({ student_id: user._id }).populate('subject_id');
        }

        // 7. Render
        res.render('app', data);
    } catch (err) {
        console.error(err);
        res.status(500).send("An error occurred while loading the page.");
    }
}

app.get('/app', requireAuth, appHandler);
app.post('/app', requireAuth, appHandler);

// Catch-all
app.use((req, res) => {
    res.status(404).send(`Route Not Found: ${req.method} ${req.url}`);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
