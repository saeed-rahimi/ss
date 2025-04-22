import React, { useState, useEffect, useRef } from "react";
import { Link, useNavigate, Routes, Route } from "react-router-dom";
import axios from "axios";
import "./Dashboard.css";
import io from "socket.io-client";
import { logout } from "./api/authService";
import { getCurrentUser } from './services/userStateManager';
import JobListings from './components/specialist/JobListings';
import MyApplications from './components/specialist/MyApplications';

const SpecialistDashboard = () => {
  const [activeTab, setActiveTab] = useState("jobs");
  const [selectedChat, setSelectedChat] = useState(null);
  const [employers, setEmployers] = useState([]);
  const [availableJobs, setAvailableJobs] = useState([]);
  const [myJobs, setMyJobs] = useState([]);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [socket, setSocket] = useState(null);
  const [notification, setNotification] = useState(null);
  const [userData, setUserData] = useState(null);
  const [error, setError] = useState(null);
  const [user, setUser] = useState(getCurrentUser());
  const messagesEndRef = useRef(null);

  const navigate = useNavigate();

  useEffect(() => {
    // اطمینان از اینکه کاربر متخصص است
    if (!user.isLoggedIn || user.userType !== 'specialist') {
      navigate('/login');
    }
  }, [user, navigate]);

  // Initialize socket connection
  useEffect(() => {
    const fetchDashboardData = () => {
      fetchProfile();
      fetchJobs();
    };

    const fetchProfile = async () => {
      const token = localStorage.getItem("token");
      if (!token) {
        setError("برای دسترسی به این صفحه باید وارد شوید.");
        return;
      }
      try {
        const response = await axios.get(`/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        
        // بررسی ساختار پاسخ و استخراج اطلاعات کاربر
        const userData = response.data.data?.user || response.data.data;
        setUserData(userData);
        setProfile(userData);
        setLoading(false);
      } catch (err) {
        setError(err.response?.data?.message || "خطا در دریافت اطلاعات کاربر");
        setLoading(false);
      }
    };

    const fetchJobs = async () => {
      const token = localStorage.getItem("token");
      if (!token) return;

      console.log("Fetching jobs for specialist...");

      // Fetch available jobs
      const availableResponse = await axios.get(`/api/jobs/available`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      console.log("Available jobs:", availableResponse.data.data.length);
      setAvailableJobs(availableResponse.data.data);

      // Fetch my jobs (where I have applied)
      const myJobsResponse = await axios.get(
        `/api/specialists/my-applications`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      console.log("My job applications:", myJobsResponse.data.data.length);
      setMyJobs(myJobsResponse.data.data);

      // Also fetch employer data for messages
      if (myJobsResponse.data.data.length > 0) {
        const employerIds = [
          ...new Set(myJobsResponse.data.data.map((job) => job.employer._id)),
        ];
        const employersForChat = employerIds.map((id) => {
          const job = myJobsResponse.data.data.find(
            (j) => j.employer._id === id
          );
          return {
            id,
            name: job.employer.username,
            lastSeen: "آنلاین",
          };
        });

        setEmployers((prevEmployers) => {
          // Merge with existing employers without duplicates
          const existingIds = prevEmployers.map((e) => e.id);
          const newEmployers = employersForChat.filter(
            (e) => !existingIds.includes(e.id)
          );
          return [...prevEmployers, ...newEmployers];
        });
      }
    };

    try {
      const token = localStorage.getItem("token");
      // Load data regardless of socket connection
      fetchDashboardData();

      if (token) {
        const newSocket = io("http://localhost:5174", {
          reconnectionAttempts: 3,
          timeout: 5000,
        });

        // Authenticate with socket
        newSocket.on("connect", () => {
          console.log("Socket connected");
          newSocket.emit("authenticate", token);
        });

        newSocket.on("authenticated", (data) => {
          console.log("Socket authenticated", data);
        });

        newSocket.on("connect_error", (error) => {
          console.error("Socket connection error:", error);
        });

        newSocket.on("error", (error) => {
          console.error("Socket error:", error);
        });

        setSocket(newSocket);

        // Clean up on unmount
        return () => {
          newSocket.disconnect();
        };
      }
    } catch (error) {
      console.error("Socket initialization error:", error);
    }
  }, []);

  // Socket event listeners for real-time updates
  useEffect(() => {
    if (!socket) return;

    // Listen for new job postings
    socket.on("new-job-posted", (jobData) => {
      setAvailableJobs((prevJobs) => {
        // Check if job already exists
        const exists = prevJobs.some((job) => job._id === jobData.jobId);
        if (exists) return prevJobs;

        // Add new job to the beginning of the array
        const newJob = {
          _id: jobData.jobId,
          title: jobData.title,
          location: jobData.location,
          jobType: jobData.jobType,
          budget: jobData.budget,
          employer: {
            _id: jobData.employerId,
            username: jobData.employerName,
          },
          createdAt: jobData.createdAt,
        };

        setNotification({
          type: "new-job",
          message: `کار جدید: ${jobData.title}`,
          time: new Date(),
        });

        return [newJob, ...prevJobs];
      });
    });

    // Listen for job application accepted
    socket.on("job-application-accepted", (data) => {
      setMyJobs((prevJobs) => {
        // Check if job already exists in my jobs
        const exists = prevJobs.some((job) => job._id === data.jobId);
        if (exists) return prevJobs;

        // Add new job to my jobs
        const newJob = {
          _id: data.jobId,
          title: data.jobTitle,
          employer: {
            _id: data.employerId,
            username: data.employerName,
            companyName: data.companyName,
          },
          status: "IN_PROGRESS",
          startDate: data.startDate,
        };

        setNotification({
          type: "job-accepted",
          message: `درخواست شما برای کار "${data.jobTitle}" پذیرفته شد!`,
          time: new Date(),
        });

        return [newJob, ...prevJobs];
      });
    });

    // Listen for new messages
    socket.on("private-message", (messageData) => {
      console.log("Received private message:", messageData);
      
      if (selectedChat && selectedChat.id === messageData.sender) {
        // If chat with sender is open, add message to current chat
        setMessages((prev) => [
          ...prev,
          {
            id: messageData.id || Date.now(),
            sender: "employer",
            text: messageData.content || messageData.message,
            time: new Date().toLocaleTimeString("fa-IR", {
              hour: "2-digit",
              minute: "2-digit",
            }),
          },
        ]);
      } else {
        // If chat is not open, show notification
        setNotification({
          type: "new-message",
          message: `پیام جدید از ${messageData.senderName}`,
          time: new Date(),
        });

        // Update employers list to show unread indicator
        setEmployers((prev) => {
          const updatedEmployers = [...prev];
          const employerIndex = updatedEmployers.findIndex(
            (emp) => emp.id === messageData.sender
          );

          if (employerIndex >= 0) {
            updatedEmployers[employerIndex].hasUnread = true;
          } else {
            // Add new employer to chat list
            updatedEmployers.push({
              id: messageData.sender,
              name: messageData.senderName,
              lastSeen: "آنلاین",
              hasUnread: true,
            });
          }

          return updatedEmployers;
        });
      }
    });

    return () => {
      socket.off("new-job-posted");
      socket.off("job-application-accepted");
      socket.off("private-message");
    };
  }, [socket, selectedChat]);

  // Scroll to bottom of messages
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // ارسال پیام جدید
  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedChat || !socket) return;

    // Create room ID based on both user IDs (sorted to ensure consistency)
    const roomId = [userData._id, selectedChat.id].sort().join('-');

    console.log(`Sending message to room: ${roomId}`, {
      recipient: selectedChat.id, 
      content: newMessage,
      roomId: roomId
    });

    socket.emit("private-message", {
      recipient: selectedChat.id,
      content: newMessage,
      roomId: roomId
    });

    // Add message to UI immediately (optimistic update)
    const newMsg = {
      id: Date.now(),
      sender: "me",
      text: newMessage,
      time: new Date().toLocaleTimeString("fa-IR", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    setMessages([...messages, newMsg]);
    setNewMessage("");
  };

  // درخواست همکاری برای یک آگهی
  const handleApplyForJob = async (jobId) => {
    const token = localStorage.getItem("token");
    try {
      // Check if user is a specialist
      if (userData.userType !== "specialist") {
        setNotification({
          type: "error",
          message: "فقط متخصصان می‌توانند درخواست همکاری ارسال کنند",
          time: new Date(),
        });
        return;
      }

      console.log(`Applying for job: ${jobId}`);

      // Find job details in availableJobs
      const jobToApply = availableJobs.find(job => job._id === jobId);
      if (!jobToApply) {
        throw new Error("آگهی مورد نظر یافت نشد");
      }

      // Send request to server with correct headers
      const response = await axios.post(`/api/jobs/${jobId}/apply`, 
        { notes: "من مایل به همکاری در این پروژه هستم" }, 
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
        }
      );

      console.log("Application response:", response.data);

      // Send socket notification to employer
      if (socket && jobToApply) {
        const applicationData = {
          jobId: jobId,
          jobTitle: jobToApply.title,
          specialistId: userData._id,
          specialistName: userData.name,
          employerId: jobToApply.employer._id,
          appliedAt: new Date(),
          notes: "من مایل به همکاری در این پروژه هستم",
          specialistInfo: {
            id: userData._id,
            name: userData.name,
            phone: userData.phone,
            job: userData.job || "متخصص",
            experience: userData.experience || 0,
          }
        };

        console.log("Sending application notification:", applicationData);
        socket.emit("job-application", applicationData);
      }

      // Update UI
      setNotification({
        type: "job-applied",
        message: "درخواست همکاری شما با موفقیت ثبت شد",
        time: new Date(),
      });

      // Refresh jobs after applying
      try {
        const availableResponse = await axios.get(`/api/jobs/available`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        
        if (availableResponse.data && availableResponse.data.data) {
          setAvailableJobs(availableResponse.data.data);
        }
        
        const myJobsResponse = await axios.get(
          `/api/specialists/my-applications`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        
        if (myJobsResponse.data && myJobsResponse.data.data) {
          setMyJobs(myJobsResponse.data.data);
        }
      } catch (refreshError) {
        console.error("Error refreshing jobs after apply:", refreshError);
      }
    } catch (error) {
      console.error("Error applying for job:", error.response?.data || error);
      setNotification({
        type: "error",
        message: error.response?.data?.message || "خطا در ثبت درخواست",
        time: new Date(),
      });
    }
  };

  // Format date
  const formatDate = (dateString) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("fa-IR").format(date);
  };

  // Calculate distance
  const calculateDistance = (jobLocation) => {
    if (!profile || !profile.location || !jobLocation) return "نامشخص";

    // Calculate distance using Haversine formula
    const R = 6371; // Radius of the Earth in km
    const lat1 = profile.location.coordinates[1];
    const lon1 = profile.location.coordinates[0];
    const lat2 = jobLocation.coordinates[1];
    const lon2 = jobLocation.coordinates[0];

    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    return `${distance.toFixed(1)} کیلومتر`;
  };

  if (loading) {
    return (
      <div
        className="d-flex justify-content-center align-items-center"
        style={{ height: "100vh" }}
      >
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">در حال بارگذاری...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="container-fluid">
      <div className="row">
        {/* نوار کناری */}
        <div className="col-md-3 col-lg-2 d-md-block bg-light sidebar collapse" style={{ minHeight: '100vh' }}>
          <div className="position-sticky pt-3">
            <div className="text-center mb-4">
              <div className="d-inline-flex align-items-center justify-content-center bg-primary text-white rounded-circle mb-2" style={{ width: '80px', height: '80px', fontSize: '2rem' }}>
                {user.username ? user.username.charAt(0).toUpperCase() : 'U'}
              </div>
              <h5 className="mt-2">{user.username || 'کاربر متخصص'}</h5>
              <p className="text-muted">{user.userType === 'specialist' ? 'متخصص' : ''}</p>
            </div>
            
            <ul className="nav flex-column">
              <li className="nav-item">
                <Link to="/specialist-dashboard" className="nav-link active">
                  <i className="bi bi-house-door me-2"></i>
                  داشبورد
                </Link>
              </li>
              <li className="nav-item">
                <Link to="/specialist-dashboard/jobs" className="nav-link">
                  <i className="bi bi-briefcase me-2"></i>
                  آگهی‌های شغلی
                </Link>
              </li>
              <li className="nav-item">
                <Link to="/specialist-dashboard/applications" className="nav-link">
                  <i className="bi bi-send me-2"></i>
                  درخواست‌های من
                </Link>
              </li>
              <li className="nav-item">
                <Link to="/specialist-dashboard/profile" className="nav-link">
                  <i className="bi bi-person me-2"></i>
                  پروفایل من
                </Link>
              </li>
              <li className="nav-item">
                <Link to="/specialist-dashboard/messages" className="nav-link">
                  <i className="bi bi-chat me-2"></i>
                  پیام‌های من
                </Link>
              </li>
            </ul>
            
            <hr />
            
            <div className="px-3 mt-4">
              <Link to="/" className="btn btn-outline-secondary w-100">
                <i className="bi bi-arrow-right me-2"></i>
                بازگشت به سایت
              </Link>
            </div>
          </div>
        </div>

        {/* محتوای اصلی */}
        <div className="col-md-9 ms-sm-auto col-lg-10 px-md-4 py-4">
          <Routes>
            <Route path="/" element={<SpecialistHome user={user} />} />
            <Route path="/jobs" element={<JobListings />} />
            <Route path="/applications" element={<MyApplications />} />
            <Route path="/profile" element={<SpecialistProfile user={user} />} />
            <Route path="/messages" element={<SpecialistMessages />} />
          </Routes>
        </div>
      </div>
    </div>
  );
};

// کامپوننت صفحه اصلی داشبورد
function SpecialistHome({ user }) {
  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2>داشبورد متخصص</h2>
        <div>
          <span className="text-muted me-2">امروز:</span>
          {new Date().toLocaleDateString('fa-IR')}
        </div>
      </div>
      
      {/* کارت‌های آماری */}
      <div className="row mb-4">
        <div className="col-md-4 mb-3">
          <div className="card bg-primary text-white h-100">
            <div className="card-body d-flex align-items-center">
              <i className="bi bi-briefcase fs-1 me-3"></i>
              <div>
                <h5 className="card-title">آگهی‌های شغلی</h5>
                <h2 className="mb-0">12</h2>
                <p className="card-text mb-0">آگهی جدید</p>
              </div>
            </div>
            <div className="card-footer bg-primary border-0">
              <Link to="/specialist-dashboard/jobs" className="text-white text-decoration-none small">
                مشاهده آگهی‌ها
                <i className="bi bi-chevron-left ms-1"></i>
              </Link>
            </div>
          </div>
        </div>
        
        <div className="col-md-4 mb-3">
          <div className="card bg-success text-white h-100">
            <div className="card-body d-flex align-items-center">
              <i className="bi bi-send fs-1 me-3"></i>
              <div>
                <h5 className="card-title">درخواست‌های من</h5>
                <h2 className="mb-0">5</h2>
                <p className="card-text mb-0">درخواست فعال</p>
              </div>
            </div>
            <div className="card-footer bg-success border-0">
              <Link to="/specialist-dashboard/applications" className="text-white text-decoration-none small">
                مشاهده درخواست‌ها
                <i className="bi bi-chevron-left ms-1"></i>
              </Link>
            </div>
          </div>
        </div>
        
        <div className="col-md-4 mb-3">
          <div className="card bg-info text-white h-100">
            <div className="card-body d-flex align-items-center">
              <i className="bi bi-chat fs-1 me-3"></i>
              <div>
                <h5 className="card-title">پیام‌ها</h5>
                <h2 className="mb-0">3</h2>
                <p className="card-text mb-0">پیام جدید</p>
              </div>
            </div>
            <div className="card-footer bg-info border-0">
              <Link to="/specialist-dashboard/messages" className="text-white text-decoration-none small">
                مشاهده پیام‌ها
                <i className="bi bi-chevron-left ms-1"></i>
              </Link>
            </div>
          </div>
        </div>
      </div>
      
      {/* آگهی‌های اخیر */}
      <div className="card mb-4">
        <div className="card-header">
          <h5 className="card-title mb-0">آگهی‌های اخیر</h5>
        </div>
        <div className="card-body">
          <div className="list-group">
            <Link to="/specialist-dashboard/jobs" className="list-group-item list-group-item-action d-flex justify-content-between align-items-center">
              <div>
                <h6 className="mb-1">نقاشی ساختمان مسکونی</h6>
                <p className="text-muted mb-0 small">شمال شیراز - ۴ روز پیش</p>
              </div>
              <span className="badge bg-primary rounded-pill">جدید</span>
            </Link>
            <Link to="/specialist-dashboard/jobs" className="list-group-item list-group-item-action d-flex justify-content-between align-items-center">
              <div>
                <h6 className="mb-1">لوله کشی آشپزخانه</h6>
                <p className="text-muted mb-0 small">مرکز شیراز - ۶ روز پیش</p>
              </div>
              <span className="badge bg-primary rounded-pill">جدید</span>
            </Link>
            <Link to="/specialist-dashboard/jobs" className="list-group-item list-group-item-action d-flex justify-content-between align-items-center">
              <div>
                <h6 className="mb-1">برق کشی ساختمان تجاری</h6>
                <p className="text-muted mb-0 small">شرق شیراز - ۷ روز پیش</p>
              </div>
            </Link>
          </div>
        </div>
        <div className="card-footer text-end">
          <Link to="/specialist-dashboard/jobs" className="btn btn-primary btn-sm">مشاهده همه آگهی‌ها</Link>
        </div>
      </div>
    </div>
  );
}

// نمونه کامپوننت‌های دیگر (می‌توان بعداً به فایل‌های جداگانه منتقل کرد)
function SpecialistProfile({ user }) {
  return (
    <div>
      <h2 className="mb-4">پروفایل من</h2>
      <div className="card">
        <div className="card-body">
          <h5 className="card-title mb-4">اطلاعات شخصی</h5>
          <form>
            <div className="row mb-3">
              <div className="col-md-6">
                <label className="form-label">نام و نام خانوادگی</label>
                <input type="text" className="form-control" defaultValue={user.username} />
              </div>
              <div className="col-md-6">
                <label className="form-label">ایمیل</label>
                <input type="email" className="form-control" defaultValue={user.email} readOnly />
              </div>
            </div>
            <div className="row mb-3">
              <div className="col-md-6">
                <label className="form-label">شماره تماس</label>
                <input type="tel" className="form-control" defaultValue={user.phone} />
              </div>
              <div className="col-md-6">
                <label className="form-label">تخصص</label>
                <select className="form-select">
                  <option>نقاشی ساختمان</option>
                  <option>برق کشی</option>
                  <option>لوله کشی</option>
                  <option>کاشی کاری</option>
                  <option>نجاری</option>
                </select>
              </div>
            </div>
            <div className="mb-3">
              <label className="form-label">آدرس</label>
              <textarea className="form-control" rows="3"></textarea>
            </div>
            <div className="mb-3">
              <label className="form-label">درباره من</label>
              <textarea className="form-control" rows="4" placeholder="توضیحات مختصری درباره تخصص و تجربیات خود بنویسید..."></textarea>
            </div>
            <button type="submit" className="btn btn-primary">بروزرسانی اطلاعات</button>
          </form>
        </div>
      </div>
    </div>
  );
}

function SpecialistMessages() {
  return (
    <div>
      <h2 className="mb-4">پیام‌های من</h2>
      <div className="card">
        <div className="card-body">
          <p>بخش پیام‌های شما در حال توسعه است.</p>
        </div>
      </div>
    </div>
  );
}

export default SpecialistDashboard;
