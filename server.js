const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
// Make sure to replace <db_password> in your environment variables on Render!
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://root:<db_password>@cluster0.ordklei.mongodb.net/college_cms?appName=Cluster0';

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: 'secret_key_cms', resave: false, saveUninitialized: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// MongoDB Connection
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => {
        console.log('MongoDB Connected');
        initAdmin();
    })
    .catch(err => console.log('DB Connection Error:', err));

// Mongoose Models
const Course = mongoose.model('Course', new mongoose.Schema({ name: String }));
const Subject = mongoose.model('Subject', new mongoose.Schema({ name: String, course_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' } }));
const User = mongoose.model('User', new mongoose.Schema({
    full_name: String, email: String, password: { type: String, default: '123456' }, 
    role: { type: String, enum: ['admin', 'staff', 'student'] }, gender: String, address: String, 
    profile_pic: { type: String, default: 'default.png' },
    course_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' }, session_id: String
}));
const Attendance = mongoose.model('Attendance', new mongoose.Schema({
    student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    subject_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject' },
    course_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
    status: String, date: String
}));
const Score = mongoose.model('Score', new mongoose.Schema({
    student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    subject_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject' },
    score: Number
}));
const Leave = mongoose.model('Leave', new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    role: String, date: String, message: String, status: { type: String, default: 'Pending' }, created_at: { type: Date, default: Date.now }
}));
const Notification = mongoose.model('Notification', new mongoose.Schema({
    message: String, type: String, created_at: { type: Date, default: Date.now }
}));
const Feedback = mongoose.model('Feedback', new mongoose.Schema({
    student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, message: String, created_at: { type: Date, default: Date.now }
}));

// Initialize Admin
async function initAdmin() {
    const admin = await User.findOne({ role: 'admin' });
    if (!admin) await User.create({ email: 'admin', password: '123456', role: 'admin', full_name: 'Administrator' });
}

// Auth Middleware
const requireAuth = (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    next();
};

// Routes
app.get('/', (req, res) => res.redirect('/app'));

app.get('/login', (req, res) => {
    res.render('login', { error: req.query.error });
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    if (user) {
        req.session.user = user;
        res.redirect('/app?page=dashboard');
    } else {
        res.redirect('/login?error=Invalid credentials');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// App Router
app.all('/app', requireAuth, async (req, res) => {
    let success_msg = req.query.msg || "";
    const page = req.query.page || 'dashboard';
    const user = req.session.user;
    
    // Handling Deletions via GET like original PHP
    if (req.query.delete && req.query.table && req.query.id) {
        const { table, id } = req.query;
        if (table === 'courses') await Course.findByIdAndDelete(id);
        if (table === 'subjects') await Subject.findByIdAndDelete(id);
        if (table === 'staff' || table === 'students') await User.findByIdAndDelete(id);
        success_msg = "Record deleted successfully.";
        return res.redirect(`/app?page=${req.query.page}&msg=${success_msg}`);
    }

    // Handling POST forms
    if (req.method === 'POST') {
        const action = req.body.action;
        if (action === 'add_course') {
            await Course.create({ name: req.body.name });
            success_msg = "Course added.";
        }
        else if (action === 'add_subject') {
            await Subject.create({ name: req.body.name, course_id: req.body.course_id });
            success_msg = "Subject added.";
        }
        else if (action === 'add_staff') {
            await User.create({ ...req.body, role: 'staff' });
            success_msg = "Staff added.";
        }
        else if (action === 'add_student') {
            await User.create({ ...req.body, role: 'student' });
            success_msg = "Student added.";
        }
        else if (action === 'save_attendance') {
            const { date, course_id, subject_id, attendance } = req.body;
            await Attendance.deleteMany({ date, subject_id, course_id });
            if (attendance) {
                for (let std_id in attendance) {
                    await Attendance.create({ student_id: std_id, subject_id, course_id, status: attendance[std_id], date });
                }
            }
            success_msg = "Attendance saved.";
        }
        else if (action === 'save_scores') {
            const { subject_id, score } = req.body;
            if(score) {
                for (let std_id in score) {
                    if (score[std_id] !== '') {
                        await Score.findOneAndUpdate(
                            { student_id: std_id, subject_id: subject_id },
                            { score: score[std_id] },
                            { upsert: true, new: true }
                        );
                    }
                }
            }
            success_msg = "Scores updated.";
        }
        else if (action === 'apply_leave') {
            await Leave.create({ user_id: user._id, role: user.role, date: req.body.date, message: req.body.message });
            success_msg = "Leave request sent.";
        }
        else if (action === 'update_leave') {
            await Leave.findByIdAndUpdate(req.body.leave_id, { status: req.body.status });
            success_msg = "Leave status updated.";
        }
        else if (action === 'send_notification') {
            await Notification.create({ message: req.body.message, type: req.body.type });
            success_msg = "Notification sent.";
        }
        else if (action === 'send_feedback') {
            await Feedback.create({ student_id: user._id, message: req.body.message });
            success_msg = "Feedback sent.";
        }
        return res.redirect(`/app?page=${page}&msg=${success_msg}`);
    }

    // Fetch required data based on page & role
    let data = { user, page, success_msg, fetched_students: [], exam_students: [], existing_scores: {}, existing_attendance: {} };
    
    // Global Datasets
    data.courses = await Course.find();
    data.subjects = await Subject.find().populate('course_id');
    
    if (page === 'dashboard') {
        data.total_students = await User.countDocuments({ role: 'student' });
        data.total_staff = await User.countDocuments({ role: 'staff' });
        data.total_courses = await Course.countDocuments();
        data.total_subjects = await Subject.countDocuments();
        data.att_count = await Attendance.countDocuments();
        if(user.role === 'student') {
            data.total_present = await Attendance.countDocuments({ student_id: user._id, status: 'Present' });
            data.total_total = await Attendance.countDocuments({ student_id: user._id });
        }
    }
    if (page === 'manage_staff') data.staffs = await User.find({ role: 'staff' });
    if (page === 'manage_students') data.students = await User.find({ role: 'student' }).populate('course_id');
    if (page === 'manage_attendance' || page === 'take_attendance') {
        if (req.query.fetch_course && req.query.fetch_date && req.query.fetch_subject) {
            data.fetched_students = await User.find({ role: 'student', course_id: req.query.fetch_course });
            const atts = await Attendance.find({ date: req.query.fetch_date, subject_id: req.query.fetch_subject });
            atts.forEach(a => { data.existing_attendance[a.student_id] = a.status; });
            data.fetch_date = req.query.fetch_date; data.fetch_course = req.query.fetch_course; data.fetch_subject = req.query.fetch_subject;
        }
    }
    if (page === 'manage_exams') {
        if(req.query.fetch_course && req.query.fetch_subject) {
            data.exam_students = await User.find({ role: 'student', course_id: req.query.fetch_course });
            const scores = await Score.find({ subject_id: req.query.fetch_subject });
            scores.forEach(s => { data.existing_scores[s.student_id] = s.score; });
            data.fetch_course = req.query.fetch_course; data.fetch_subject = req.query.fetch_subject;
        }
    }
    if (page === 'notifications' && user.role === 'admin') data.leaves = await Leave.find().populate('user_id').sort('-created_at');
    if (page === 'staff_notifs' || page === 'student_notifs') {
        data.notifs = await Notification.find({ type: user.role === 'staff' ? 'staff' : 'student' }).sort('-created_at');
    }
    if (page === 'apply_leave') data.my_leaves = await Leave.find({ user_id: user._id }).sort('-created_at');
    if (page === 'view_attendance' && user.role === 'staff') {
        data.logs = await Attendance.find().populate('student_id subject_id').sort('-date').limit(50);
    }
    if (page === 'my_attendance' && user.role === 'student') {
        data.my_att = await Attendance.find({ student_id: user._id }).populate('subject_id').sort('-date');
    }
    if (page === 'exam_results' && user.role === 'student') {
        data.scores = await Score.find({ student_id: user._id }).populate('subject_id');
    }

    res.render('app', data);
});

app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
