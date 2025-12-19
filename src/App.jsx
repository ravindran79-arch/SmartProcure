import React, { useState, useCallback, useEffect } from 'react';
import { 
    FileUp, Send, Loader2, AlertTriangle, CheckCircle, List, FileText, BarChart2,
    Save, Clock, Zap, ArrowLeft, Users, Briefcase, Layers, UserPlus, LogIn, Tag,
    Shield, User, HardDrive, Phone, Mail, Building, Trash2, Eye, DollarSign, Activity, 
    Printer, Download, MapPin, Calendar, ThumbsUp, ThumbsDown, Gavel, Paperclip, Copy, Award, Lock, CreditCard, Info,
    Search, FileCheck, XCircle, Scale
} from 'lucide-react'; 

// --- FIREBASE IMPORTS ---
import { initializeApp } from 'firebase/app';
import { 
    getAuth, onAuthStateChanged, createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, signOut, sendEmailVerification 
} from 'firebase/auth';
import { 
    getFirestore, collection, addDoc, onSnapshot, query, doc, setDoc, 
    runTransaction, deleteDoc, getDocs, getDoc, collectionGroup
} from 'firebase/firestore'; 

// --- FIREBASE INITIALIZATION ---
// (Ensure your .env variables are set for the new project if you created a new Firebase project)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- CONSTANTS ---
const API_URL = '/api/analyze'; 
const MAX_FREE_AUDITS = 3; 

// UPDATED: Categories for Procurement
const CATEGORY_ENUM = ["MANDATORY", "COMMERCIAL", "TECHNICAL", "LEGAL", "HSE/QUALITY", "TIMELINE", "OTHER"];

const PAGE = {
    HOME: 'HOME',
    COMPLIANCE_CHECK: 'COMPLIANCE_CHECK', 
    ADMIN: 'ADMIN',                     
    HISTORY: 'HISTORY' 
};

// --- NEW SMARTPROCURE SCHEMA ---
const COMPREHENSIVE_REPORT_SCHEMA = {
    type: "OBJECT",
    description: "Procurement Audit Report analyzing Vendor Proposal against RFQ.",
    properties: {
        // --- HEADER DATA ---
        "projectTitle": { "type": "STRING", "description": "Project Name from RFQ." },
        "vendorName": { "type": "STRING", "description": "Name of the Vendor/Bidder." },
        "totalBidValue": { "type": "STRING", "description": "Total Cost of Ownership (TCO) proposed." },
        
        // --- COMMERCIAL DATA ---
        "commercialSummary": {
            "type": "OBJECT",
            "properties": {
                "paymentTerms": { "type": "STRING", "description": "Vendor's proposed payment terms (e.g. Net 30)." },
                "warrantyPeriod": { "type": "STRING", "description": "Proposed warranty duration." },
                "validityPeriod": { "type": "STRING", "description": "How long the quote is valid." }
            }
        },

        // --- RISK METRICS ---
        "riskScore": { 
            "type": "NUMBER", 
            "description": "0-100 Score. 0 = Safe, 100 = High Risk. Based on deviations and vague language." 
        },
        "riskLevel": { "type": "STRING", "enum": ["LOW RISK", "MEDIUM RISK", "HIGH RISK", "CRITICAL"] },
        "redLineAlerts": { 
            "type": "ARRAY", 
            "items": { "type": "STRING" },
            "description": "List of legal/commercial deviations (e.g., 'Vendor rejected Liability Cap')." 
        },

        // --- MANDATORY CHECKS ---
        "mandatoryChecklist": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "item": { "type": "STRING" },
                    "status": { "type": "STRING", "enum": ["PASS", "FAIL"] }
                }
            },
            "description": "Checklist: NDA Signed? Timeline Met? ISO Cert Attached?"
        },

        // --- COMPLIANCE FINDINGS ---
        "executiveSummary": { "type": "STRING", "description": "3-sentence summary for the CPO (Chief Procurement Officer)." },
        "findings": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "requirementFromRFQ": { "type": "STRING" },
                    "vendorResponse": { "type": "STRING" },
                    "complianceScore": { "type": "NUMBER", "description": "0 = Non-Compliant, 1 = Compliant" },
                    "flag": { "type": "STRING", "enum": ["COMPLIANT", "PARTIAL", "NON-COMPLIANT"] },
                    "category": { "type": "STRING", "enum": CATEGORY_ENUM },
                    "procurementAction": { 
                        "type": "STRING", 
                        "description": "Advice for the Buyer: e.g., 'Reject', 'Clarify', or 'Accept'. If Partial, suggest specific clarification question." 
                    }
                }
            }
        }
    },
    "required": ["projectTitle", "vendorName", "totalBidValue", "riskScore", "riskLevel", "commercialSummary", "redLineAlerts", "mandatoryChecklist", "executiveSummary", "findings"]
};

// --- UTILS ---
const fetchWithRetry = async (url, options, maxRetries = 3) => {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
            return response;
        } catch (error) {
            if (i === maxRetries - 1) throw error; 
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
        }
    }
};

const getUsageDocRef = (db, userId) => doc(db, `users/${userId}/usage_limits`, 'main_tracker');
const getReportsCollectionRef = (db, userId) => collection(db, `users/${userId}/compliance_reports`);

// --- METRIC CALCULATORS ---
const getCompliancePercentage = (report) => {
    const findings = report.findings || []; 
    const totalScore = findings.reduce((sum, item) => {
        let score = item.complianceScore || 0;
        if (score > 1) score = score / 100;
        return sum + score;
    }, 0);
    const maxScore = findings.length * 1;
    return maxScore > 0 ? parseFloat(((totalScore / maxScore) * 100).toFixed(1)) : 0;
};

const processFile = (file) => {
    return new Promise(async (resolve, reject) => {
        const fileExtension = file.name.split('.').pop().toLowerCase();
        const reader = new FileReader();
        if (fileExtension === 'txt') {
            reader.onload = (event) => resolve(event.target.result);
            reader.onerror = reject;
            reader.readAsText(file);
        } else if (fileExtension === 'pdf') {
            if (typeof window.pdfjsLib === 'undefined') return reject("PDF lib not loaded.");
            reader.onload = async (event) => {
                try {
                    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(event.target.result) }).promise;
                    let fullText = '';
                    for (let i = 1; i <= pdf.numPages; i++) {
                        const page = await pdf.getPage(i);
                        const textContent = await page.getTextContent();
                        fullText += textContent.items.map(item => item.str).join(' ') + '\n\n'; 
                    }
                    resolve(fullText);
                } catch (e) { reject(e.message); }
            };
            reader.readAsArrayBuffer(file);
        } else if (fileExtension === 'docx') {
            if (typeof window.mammoth === 'undefined') return reject("DOCX lib not loaded.");
            reader.onload = async (event) => {
                try {
                    const result = await window.mammoth.extractRawText({ arrayBuffer: event.target.result });
                    resolve(result.value); 
                } catch (e) { reject(e.message); }
            };
            reader.readAsArrayBuffer(file);
        } else {
            reject('Unsupported file type.');
        }
    });
};

class ErrorBoundary extends React.Component {
    constructor(props) { super(props); this.state = { hasError: false, error: null }; }
    static getDerivedStateFromError(error) { return { hasError: true }; }
    componentDidCatch(error, errorInfo) { this.setState({ error, errorInfo }); }
    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen bg-red-900 font-body p-8 text-white flex items-center justify-center">
                    <div className="bg-red-800 p-8 rounded-xl border border-red-500 max-w-lg">
                        <AlertTriangle className="w-8 h-8 text-red-300 mx-auto mb-4"/>
                        <h2 className="text-xl font-bold mb-2">System Error</h2>
                        <p className="text-sm font-mono">{this.state.error && this.state.error.toString()}</p>
                    </div>
                </div>
            );
        }
        return this.props.children; 
    }
}

// --- COMPONENTS ---
const handleFileChange = (e, setFile, setErrorMessage) => {
    if (e.target.files.length > 0) {
        setFile(e.target.files[0]);
        if (setErrorMessage) setErrorMessage(null); 
    }
};

const FormInput = ({ label, name, value, onChange, type, placeholder, id }) => (
    <div>
        <label htmlFor={id || name} className="block text-sm font-medium text-slate-300 mb-1">{label}</label>
        <input
            id={id || name}
            name={name}
            type={type}
            value={value}
            onChange={onChange}
            placeholder={placeholder || ''}
            required={label.includes('*')}
            className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:ring-blue-500 focus:border-blue-500 text-sm"
        />
    </div>
);

const PaywallModal = ({ show, onClose, userId }) => {
    if (!show) return null;
    const STRIPE_PAYMENT_LINK = "https://buy.stripe.com/cNi00i4JHdOmdTT8VJafS00"; 
    const handleUpgrade = () => {
        if (userId) {
            window.location.href = `${STRIPE_PAYMENT_LINK}?client_reference_id=${userId}`;
        } else {
            alert("Error: User ID missing.");
        }
    };
    return (
        <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-sm flex items-center justify-center z-50 p-4 no-print">
            <div className="bg-slate-800 rounded-2xl shadow-2xl border border-blue-500/50 max-w-md w-full p-8 text-center relative">
                <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 bg-blue-600 rounded-full p-4 shadow-lg">
                    <Lock className="w-10 h-10 text-white" />
                </div>
                <h2 className="text-2xl font-bold text-white mt-8 mb-2">Audit Limit Reached</h2>
                <p className="text-slate-300 mb-6">Upgrade to <strong>SmartProcure Pro</strong> for unlimited vendor evaluations.</p>
                <button onClick={handleUpgrade} className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-all shadow-lg mb-3 flex items-center justify-center">
                    <CreditCard className="w-5 h-5 mr-2"/> Upgrade - $49/mo
                </button>
                <button onClick={onClose} className="text-sm text-slate-400 hover:text-white">Cancel</button>
            </div>
        </div>
    );
};

const FileUploader = ({ title, file, setFile, color, requiredText }) => (
    <div className={`p-6 border-2 border-dashed border-${color}-600/50 rounded-2xl bg-slate-900/50 space-y-3 no-print`}>
        <h3 className={`text-lg font-bold text-${color}-400 flex items-center`}><FileUp className={`w-6 h-6 mr-2 text-${color}-500`} /> {title}</h3>
        <p className="text-sm text-slate-400">{requiredText}</p>
        <input type="file" accept=".txt,.pdf,.docx" onChange={setFile} className="w-full text-base text-slate-300"/>
        {file && <p className="text-sm font-medium text-green-400 flex items-center"><CheckCircle className="w-4 h-4 mr-1 text-green-500" /> {file.name}</p>}
    </div>
);

// --- MAIN REPORT COMPONENT (PROCUREMENT VIEW) ---
const ComplianceReport = ({ report }) => {
    const overallPercentage = getCompliancePercentage(report);
    
    // Determine Risk Color
    const riskColor = report.riskLevel === 'CRITICAL' || report.riskLevel === 'HIGH RISK' ? 'text-red-500' 
        : report.riskLevel === 'MEDIUM RISK' ? 'text-amber-500' : 'text-green-500';

    return (
        <div id="printable-compliance-report" className="bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700 mt-8">
            <div className="flex justify-between items-center mb-6 border-b border-slate-700 pb-4">
                <div>
                    <h2 className="text-3xl font-extrabold text-white flex items-center"><Shield className="w-8 h-8 mr-3 text-blue-400"/> Vendor Evaluation Report</h2>
                    <p className="text-slate-400 text-sm mt-1">Vendor: <span className="text-white font-bold">{report.vendorName || "Unknown"}</span></p>
                </div>
                <button onClick={() => window.print()} className="text-sm text-slate-400 hover:text-white bg-slate-700 px-3 py-2 rounded-lg flex items-center no-print">
                    <Printer className="w-4 h-4 mr-2"/> Print / PDF
                </button>
            </div>

            {/* SCORECARDS */}
            <div className="mb-10 grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="p-5 bg-slate-700/50 rounded-xl border border-slate-600 text-center">
                    <p className="text-sm font-semibold text-slate-400 mb-1">Compliance Match</p>
                    <div className="text-4xl font-extrabold text-white">{overallPercentage}%</div>
                </div>
                <div className="p-5 bg-slate-700/50 rounded-xl border border-slate-600 text-center">
                    <p className="text-sm font-semibold text-slate-400 mb-1">Risk Assessment</p>
                    <div className={`text-4xl font-extrabold ${riskColor}`}>{report.riskLevel}</div>
                    <p className="text-xs text-slate-500 mt-1">Score: {report.riskScore}/100</p>
                </div>
                <div className="p-5 bg-slate-700/50 rounded-xl border border-slate-600 text-center">
                    <p className="text-sm font-semibold text-slate-400 mb-1">Total Bid Value</p>
                    <div className="text-2xl font-extrabold text-green-400 mt-2">{report.totalBidValue || "Not Found"}</div>
                </div>
            </div>

            {/* EXECUTIVE SUMMARY */}
            <div className="mb-8 p-6 bg-slate-700/30 rounded-xl border border-blue-500/30">
                <h3 className="text-lg font-bold text-blue-200 mb-2 flex items-center"><FileText className="w-5 h-5 mr-2"/> Auditor's Summary</h3>
                <p className="text-slate-300 italic leading-relaxed">{report.executiveSummary}</p>
            </div>

            {/* COMMERCIAL & MANDATORY CHECKS */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
                <div className="p-5 bg-slate-900/50 rounded-xl border border-slate-700">
                    <h4 className="text-md font-bold text-white mb-4 flex items-center"><DollarSign className="w-4 h-4 mr-2 text-green-400"/> Commercial Terms</h4>
                    <ul className="space-y-3 text-sm">
                        <li className="flex justify-between border-b border-slate-800 pb-2">
                            <span className="text-slate-400">Payment Terms</span>
                            <span className="text-white">{report.commercialSummary?.paymentTerms || "N/A"}</span>
                        </li>
                        <li className="flex justify-between border-b border-slate-800 pb-2">
                            <span className="text-slate-400">Warranty</span>
                            <span className="text-white">{report.commercialSummary?.warrantyPeriod || "N/A"}</span>
                        </li>
                        <li className="flex justify-between">
                            <span className="text-slate-400">Bid Validity</span>
                            <span className="text-white">{report.commercialSummary?.validityPeriod || "N/A"}</span>
                        </li>
                    </ul>
                </div>
                <div className="p-5 bg-slate-900/50 rounded-xl border border-slate-700">
                    <h4 className="text-md font-bold text-white mb-4 flex items-center"><FileCheck className="w-4 h-4 mr-2 text-purple-400"/> Mandatory Checklist</h4>
                    <ul className="space-y-2 text-sm">
                        {report.mandatoryChecklist?.map((item, i) => (
                            <li key={i} className="flex items-center justify-between">
                                <span className="text-slate-300">{item.item}</span>
                                {item.status === 'PASS' ? 
                                    <span className="px-2 py-0.5 rounded bg-green-900/50 text-green-400 text-xs font-bold">PASS</span> : 
                                    <span className="px-2 py-0.5 rounded bg-red-900/50 text-red-400 text-xs font-bold">FAIL</span>
                                }
                            </li>
                        ))}
                    </ul>
                </div>
            </div>

            {/* RED LINE ALERTS */}
            {report.redLineAlerts?.length > 0 && (
                <div className="mb-10 p-5 bg-red-950/30 rounded-xl border border-red-600/50">
                    <h4 className="text-lg font-bold text-red-400 mb-3 flex items-center"><Gavel className="w-5 h-5 mr-2"/> Critical Red Lines Detected</h4>
                    <ul className="list-disc list-inside space-y-1">
                        {report.redLineAlerts.map((alert, i) => (
                            <li key={i} className="text-red-200 text-sm">{alert}</li>
                        ))}
                    </ul>
                </div>
            )}

            {/* DETAILED FINDINGS */}
            <h3 className="text-2xl font-bold text-white mb-6 border-b border-slate-700 pb-3">Compliance Gap Analysis</h3>
            <div className="space-y-6">
                {report.findings?.map((item, index) => (
                    <div key={index} className="p-6 border border-slate-700 rounded-xl bg-slate-800 hover:bg-slate-700/50 transition">
                        <div className="flex justify-between items-start mb-3">
                            <span className={`px-3 py-1 text-xs font-bold rounded uppercase tracking-wider ${
                                item.flag === 'COMPLIANT' ? 'bg-green-900 text-green-300' : 
                                item.flag === 'PARTIAL' ? 'bg-amber-900 text-amber-300' : 'bg-red-900 text-red-300'
                            }`}>{item.flag}</span>
                            <span className="text-xs text-slate-500 uppercase">{item.category}</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <p className="text-xs text-slate-500 font-bold uppercase mb-1">Requirement (RFQ)</p>
                                <p className="text-sm text-slate-300 italic bg-slate-900/50 p-3 rounded border border-slate-700">
                                    "{item.requirementFromRFQ}"
                                </p>
                            </div>
                            <div>
                                <p className="text-xs text-slate-500 font-bold uppercase mb-1">Vendor Response</p>
                                <p className="text-sm text-white">
                                    {item.vendorResponse}
                                </p>
                            </div>
                        </div>
                        {item.flag !== 'COMPLIANT' && (
                            <div className="mt-4 pt-4 border-t border-slate-700">
                                <p className="text-xs text-blue-400 font-bold uppercase mb-1">Recommended Action</p>
                                <p className="text-sm text-blue-100">{item.procurementAction}</p>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- AUTH & PAGES ---
const AuthPage = ({ setCurrentPage, setErrorMessage, errorMessage, db, auth }) => {
    const [regForm, setRegForm] = useState({ name: '', designation: '', company: '', email: '', phone: '', password: '' });
    const [loginForm, setLoginForm] = useState({ email: '', password: '' });
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleRegister = async (e) => {
        e.preventDefault();
        setErrorMessage(null);
        setIsSubmitting(true);
        try {
            const userCred = await createUserWithEmailAndPassword(auth, regForm.email, regForm.password);
            await sendEmailVerification(userCred.user);
            await setDoc(doc(db, 'users', userCred.user.uid), {
                name: regForm.name,
                designation: regForm.designation,
                company: regForm.company,
                email: regForm.email,
                phone: regForm.phone,
                role: 'PROCURER', // Default role for this app
                createdAt: Date.now()
            });
            await addDoc(collection(db, 'mail'), {
                to: regForm.email,
                message: {
                    subject: 'Welcome to SmartProcure – Start Evaluating Vendors',
                    html: `<p>Hi ${regForm.name},</p><p>Welcome to <strong>SmartProcure</strong>. Your automated procurement assistant is ready.</p>`
                }
            });
            await signOut(auth);
            setLoginForm({ email: regForm.email, password: regForm.password });
            setErrorMessage('SUCCESS: Account created! Verification email sent.');
        } catch (err) { setErrorMessage(err.message); } 
        finally { setIsSubmitting(false); }
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        setErrorMessage(null);
        setIsSubmitting(true);
        try {
            await signInWithEmailAndPassword(auth, loginForm.email, loginForm.password);
        } catch (err) { setErrorMessage(err.message); setIsSubmitting(false); }
    };

    return (
        <div className="p-8 bg-slate-800 rounded-2xl shadow-2xl border border-slate-700 mt-12 mb-12">
            <h2 className="text-3xl font-extrabold text-white text-center">SmartProcure</h2>
            <p className="text-lg font-medium text-blue-400 text-center mb-6">AI-Powered Vendor Evaluation & Risk Analysis</p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="p-6 bg-slate-700/50 rounded-xl border border-blue-500/50">
                    <h3 className="text-2xl font-bold text-white mb-4">Procurement Registration</h3>
                    <form onSubmit={handleRegister} className="space-y-3">
                        <FormInput name="name" label="Full Name" value={regForm.name} onChange={(e) => setRegForm({...regForm, name: e.target.value})} />
                        <FormInput name="email" label="Work Email" value={regForm.email} onChange={(e) => setRegForm({...regForm, email: e.target.value})} type="email" />
                        <FormInput name="password" label="Password" value={regForm.password} onChange={(e) => setRegForm({...regForm, password: e.target.value})} type="password" />
                        <button disabled={isSubmitting} className="w-full py-3 mt-4 bg-blue-600 text-white font-bold rounded-xl">{isSubmitting ? 'Processing...' : 'Create Account'}</button>
                    </form>
                </div>
                <div className="p-6 bg-slate-700/50 rounded-xl border border-green-500/50">
                    <h3 className="text-2xl font-bold text-white mb-4">Procurer Login</h3>
                    <form onSubmit={handleLogin} className="space-y-3">
                        <FormInput name="email" label="Email" value={loginForm.email} onChange={(e) => setLoginForm({...loginForm, email: e.target.value})} type="email" />
                        <FormInput name="password" label="Password" value={loginForm.password} onChange={(e) => setLoginForm({...loginForm, password: e.target.value})} type="password" />
                        <button disabled={isSubmitting} className="w-full py-3 mt-4 bg-green-600 text-white font-bold rounded-xl">{isSubmitting ? 'Logging In...' : 'Login'}</button>
                    </form>
                    {errorMessage && <div className="mt-4 p-3 bg-red-900/50 text-red-200 rounded">{errorMessage}</div>}
                </div>
            </div>
        </div>
    );
};

// --- APP COMPONENT ---
const App = () => {
    const [currentPage, setCurrentPage] = useState(PAGE.HOME);
    const [currentUser, setCurrentUser] = useState(null);
    const [userId, setUserId] = useState(null);
    const [usageLimits, setUsageLimits] = useState({ initiatorChecks: 0, bidderChecks: 0, isSubscribed: false });
    const [RFQFile, setRFQFile] = useState(null);
    const [BidFile, setBidFile] = useState(null);
    const [report, setReport] = useState(null);
    const [loading, setLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState(null);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                setUserId(user.uid);
                setCurrentUser({ uid: user.uid });
                setCurrentPage(PAGE.COMPLIANCE_CHECK);
            } else {
                setUserId(null); setCurrentUser(null); setCurrentPage(PAGE.HOME);
            }
        });
        return () => unsubscribe();
    }, []);

    // USAGE LISTENER
    useEffect(() => {
        if (db && userId) {
            const docRef = getUsageDocRef(db, userId);
            const unsub = onSnapshot(docRef, (doc) => {
                if (doc.exists()) setUsageLimits({ bidderChecks: doc.data().bidderChecks || 0, isSubscribed: doc.data().isSubscribed || false });
                else setDoc(docRef, { bidderChecks: 0, isSubscribed: false });
            });
            return () => unsub();
        }
    }, [userId]);

    const handleAnalyze = useCallback(async () => {
        if (!usageLimits.isSubscribed && usageLimits.bidderChecks >= MAX_FREE_AUDITS) { alert("Limit Reached"); return; }
        if (!RFQFile || !BidFile) { setErrorMessage("Upload both documents."); return; }
        setLoading(true); setReport(null); setErrorMessage(null);

        try {
            const rfqText = await processFile(RFQFile);
            const bidText = await processFile(BidFile);

            // --- PROCUREMENT AUDITOR PROMPT ---
            const systemPrompt = {
                parts: [{
                    text: `You are the SmartProcure AI Auditor. 
                    Your goal is to protect the Buyer by finding risks, deviations, and non-compliance in the Vendor's Proposal.
                    
                    INPUTS:
                    1. <rfq_document>: The Buyer's Requirements.
                    2. <bid_document>: The Vendor's Response.

                    TASK:
                    1. EXTRACT Vendor Name, Total Bid Value, and Payment Terms.
                    2. CALCULATE a 'Risk Score' (0-100) based on non-compliance and vague language (e.g. "we aim to", "best effort").
                    3. IDENTIFY 'Red Line Alerts' -> Any legal deviations (Liability, Indemnity, Termination).
                    4. AUDIT Mandatory Requirements (NDA, Timeline, Validity).
                    5. COMPARE Line-by-Line: Does the Bid meet the RFQ?
                    
                    OUTPUT: JSON matching the schema provided.`
                }]
            };

            const userQuery = `<rfq_document>${rfqText}</rfq_document><bid_document>${bidText}</bid_document> Perform Procurement Audit.`;

            const payload = {
                contents: [{ parts: [{ text: userQuery }] }],
                systemInstruction: systemPrompt,
                generationConfig: { responseMimeType: "application/json", responseSchema: COMPREHENSIVE_REPORT_SCHEMA }
            };

            const response = await fetchWithRetry(API_URL, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
            
            if (jsonText) {
                setReport(JSON.parse(jsonText));
                // Increment Usage
                await runTransaction(db, async (t) => {
                    const ref = getUsageDocRef(db, userId);
                    const doc = await t.get(ref);
                    const newCount = (doc.data()?.bidderChecks || 0) + 1;
                    t.update(ref, { bidderChecks: newCount });
                });
            } else { throw new Error("AI Analysis Failed"); }

        } catch (e) { setErrorMessage(e.message); } 
        finally { setLoading(false); }
    }, [RFQFile, BidFile, usageLimits, userId]);

    const renderPage = () => {
        if (currentPage === PAGE.HOME) return <AuthPage setCurrentPage={setCurrentPage} setErrorMessage={setErrorMessage} errorMessage={errorMessage} db={db} auth={auth} />;
        return (
            <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700">
                <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-700">
                    <h2 className="text-2xl font-bold text-white flex items-center"><Scale className="mr-3 text-blue-400"/> Vendor Evaluation</h2>
                    <div className="text-right">
                        <button onClick={async () => await signOut(auth)} className="text-sm text-slate-400 hover:text-white">Logout</button>
                    </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                    <FileUploader title="Internal RFQ / Tender" file={RFQFile} setFile={(e) => handleFileChange(e, setRFQFile, setErrorMessage)} color="blue" requiredText="Your Requirements" />
                    <FileUploader title="Vendor Proposal" file={BidFile} setFile={(e) => handleFileChange(e, setBidFile, setErrorMessage)} color="purple" requiredText="The Bid to Audit" />
                </div>

                {errorMessage && <div className="p-4 bg-red-900/50 text-red-200 rounded mb-4">{errorMessage}</div>}

                <button onClick={handleAnalyze} disabled={loading || !RFQFile || !BidFile} className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl flex items-center justify-center">
                    {loading ? <Loader2 className="animate-spin mr-2"/> : <Search className="mr-2"/>} {loading ? "AUDITING PROPOSAL..." : "EVALUATE VENDOR"}
                </button>

                {report && <ComplianceReport report={report} />}
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-slate-900 font-body p-8 text-slate-100 max-w-5xl mx-auto">
            <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap'); .font-body { font-family: 'Inter', sans-serif; }`}</style>
            {renderPage()}
        </div>
    );
};

export default App;
