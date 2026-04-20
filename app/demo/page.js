"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useState } from "react";
import LiveKitDemo from "../components/LiveKitDemo";

export default function DemoPage() {
  const [url, setUrl] = useState("");
  const [personalizing, setPersonalizing] = useState(false);
  const [brand, setBrand] = useState("");
  const [brief, setBrief] = useState("");
  const [error, setError] = useState("");

  async function handlePersonalize(e) {
    e.preventDefault();
    setPersonalizing(true);
    setError("");
    setBrand("");
    setBrief("");
    try {
      const res = await fetch("/api/personalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setBrand(data.brand || "");
      setBrief(data.brief || "");
    } catch (err) {
      setError(err?.message || "Couldn't personalize");
    } finally {
      setPersonalizing(false);
    }
  }

  function reset() {
    setBrand("");
    setBrief("");
    setUrl("");
    setError("");
  }

  return (
    <section className="max-w-2xl mx-auto py-8">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="text-center mb-10"
      >
        <h1 className="text-[clamp(2rem,4.5vw,3.2rem)] font-extrabold tracking-[-0.03em] leading-[1.05] text-white">
          Talk to <span className="text-[#2DD4BF]">Mia</span>
        </h1>
        <p className="mt-4 text-[15px] text-[#A0A0AB] leading-relaxed max-w-lg mx-auto">
          Try the default demo as a Realtor at &ldquo;Sunbelt Realty,&rdquo; or drop in your own website and
          Mia will personalize for your brokerage — your listings, your brand, your pitch.
        </p>
      </motion.div>

      {/* Personalization panel */}
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        className={`mb-6 p-6 rounded-2xl border transition-colors ${brief ? "border-[#2DD4BF]/40 bg-[#2DD4BF]/5" : "border-[#1A1A1F] bg-[#0E0E12]"}`}
      >
        {brief ? (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-5 h-5 text-[#2DD4BF]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span className="text-[11px] font-bold tracking-[0.12em] uppercase text-[#2DD4BF]">Personalized</span>
            </div>
            <h3 className="text-[16px] font-bold text-white mb-1">Mia is ready with <span className="text-[#2DD4BF]">{brand}</span>&rsquo;s info</h3>
            <p className="text-[13px] text-[#A0A0AB] mb-4">
              She&rsquo;s read the homepage and will answer as if she worked there. Start the call below.
            </p>
            <button
              onClick={reset}
              className="text-[12px] font-semibold text-[#6B6B76] hover:text-[#2DD4BF]"
            >
              Use a different website
            </button>
          </div>
        ) : (
          <form onSubmit={handlePersonalize}>
            <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-[#2DD4BF]/70 mb-2">
              Optional
            </div>
            <h3 className="text-[16px] font-bold text-white mb-1">Personalize Mia with your website</h3>
            <p className="text-[13px] text-[#A0A0AB] mb-4">
              Paste your real estate site and Mia will greet as if she worked there — with your brand and listings on hand.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="yourrealestate.com"
                disabled={personalizing}
                className="flex-1 px-4 py-3 rounded-xl border border-[#1A1A1F] bg-[#0A0A0E] focus:border-[#2DD4BF]/50 focus:outline-none text-[14px] text-white placeholder-[#44444D]"
              />
              <button
                type="submit"
                disabled={personalizing || !url.trim()}
                className="px-5 py-3 rounded-xl bg-[#2DD4BF] hover:bg-[#5EEAD4] disabled:bg-[#1A1A1F] disabled:text-[#6B6B76] text-[#07070A] text-[13px] font-bold whitespace-nowrap transition-all"
              >
                {personalizing ? "Reading…" : "Personalize"}
              </button>
            </div>
            {error && <div className="mt-3 text-[12px] text-[#F87171]">{error}</div>}
            <div className="mt-3 text-[11px] text-[#44444D]">
              We scrape one page from the URL for the demo only — nothing stored.
            </div>
          </form>
        )}
      </motion.div>

      {/* Demo widget */}
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
      >
        <LiveKitDemo brand={brand} brief={brief} />
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.4 }}
        className="mt-12 text-center"
      >
        <h2 className="text-[15px] font-semibold text-white mb-4">Things to try</h2>
        <ul className="text-[13px] text-[#6B6B76] space-y-2">
          <li>&ldquo;Hi, I saw your listing on Maple Street. Can I see it tomorrow at 5?&rdquo;</li>
          <li>&ldquo;I&rsquo;m thinking of selling my house in 78704. Can someone give me a value?&rdquo;</li>
          <li>&ldquo;I&rsquo;m pre-approved up to $650K and want to look this weekend.&rdquo;</li>
          {brief && <li className="text-[#2DD4BF]/70">&ldquo;Tell me about the property on [your actual listing address].&rdquo;</li>}
        </ul>
        <Link
          href="/"
          className="inline-flex items-center gap-2 mt-8 text-[14px] font-semibold text-[#2DD4BF] hover:text-[#5EEAD4]"
        >
          &larr; Back to homepage
        </Link>
      </motion.div>
    </section>
  );
}
