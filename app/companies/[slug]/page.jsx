import React from "react";
import { companyNameFilter } from "@/lib/companySlug";
import { getMongoDb } from "@/lib/mongodb";

import { notFound } from "next/navigation";
import { ArrowLeft, Building2, Globe, MapPin, Pencil, Tag } from "lucide-react";
import Link from "next/link";
import ArticleCard from "@/components/ArticleCard";
import Navbar from "@/components/Navbar";

export async function generateMetadata({ params }) {
    const { slug } = await params;
    const db = await getMongoDb({ mode: "read" });
    const company = await db.collection("companies").findOne(
        { slug },
        { projection: { name: 1, slug: 1, about: 1, logo: 1, website: 1, location: 1 } }
    );

    if (!company) {
        return {
            title: "Company Not Found",
            robots: { index: false, follow: false },
        };
    }

    const title = `${company.name} Interviews`;
    const description =
        company.about?.slice(0, 180) ||
        `Read interview experiences, process details, and insights for ${company.name}.`;
    const canonical = `/companies/${company.slug}`;

    return {
        title,
        description,
        alternates: {
            canonical,
        },
        openGraph: {
            title: `${title} | The Interview Room`,
            description,
            url: `https://theinterviewroom.in${canonical}`,
            images: company.logo
                ? [
                      {
                          url: company.logo,
                          alt: company.name,
                      },
                  ]
                : undefined,
        },
        twitter: {
            title: `${title} | The Interview Room`,
            description,
            images: company.logo ? [company.logo] : undefined,
        },
    };
}

export default async function CompanyDetails({ params }) {
    const { slug } = await params;
    const db = await getMongoDb({ mode: "read" });
    const company = await db.collection("companies").findOne({ slug });

    if (!company) {
        return notFound();
    }
    const experience = db.collection("experience");
    // Case-insensitive: posts store the company as free text, so "CutShort" and
    // "Cutshort" are the same company and both belong on this page. The directory
    // counts already group case-insensitively -- this used to disagree with them.
    const experiences = await experience.find({
        company: companyNameFilter(company.name)
    }).sort({ date: -1 }).toArray();
    const interviewsCount = experiences.length;

    // Detect if this is an auto-generated generic company stub
    const isGeneric = !company.logo && !company.location && !company.website &&
        (company.about?.includes("interview experience details.") || !company.about);

    return (
        <div className="relative min-h-screen w-full overflow-x-hidden bg-slate-50 pb-20 pt-24 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
            <Navbar showThemeToggle />

            <div className="mx-auto max-w-4xl px-4 sm:px-6">

                {/* Back Link */}
                <Link
                    href="/companies"
                    className="group inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-900 transition-colors mb-8 dark:text-slate-400 dark:hover:text-slate-200"
                >
                    <ArrowLeft size={16} className="transition-transform group-hover:-translate-x-1" />
                    Back to Companies
                </Link>
                <Link
                    href={`/edit-company/${company.slug}`}
                    className="ml-3 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm transition hover:border-blue-300 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-blue-500 dark:hover:text-blue-300"
                >
                    <Pencil size={13} />
                    Edit Company
                </Link>

                {/* Company Header */}
                <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-8">
                    <div className="absolute bottom-0 left-0 top-0 w-1 bg-blue-600" />

                    <div className="relative z-10 flex flex-col sm:flex-row gap-6 sm:gap-8 items-start">

                        {/* Logo */}
                        <div className="relative shrink-0">
                            {company.logo ? (
                                <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-950 sm:h-28 sm:w-28">
                                    {/* Deliberately a raw <img>: company logos are
                                        arbitrary third-party URLs, and next/image
                                        would reject any host missing from
                                        next.config remotePatterns. Explicit
                                        width/height avoid the layout shift. */}
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={company.logo}
                                        alt={`${company.name} logo`}
                                        width={112}
                                        height={112}
                                        className="h-full w-full object-contain"
                                        loading="lazy"
                                    />
                                </div>
                            ) : (
                                <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-4xl font-bold text-blue-600 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300 sm:h-28 sm:w-28 sm:text-5xl">
                                    {(company?.name?.charAt(0) || "C").toUpperCase()}
                                </div>
                            )}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                            <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight dark:text-slate-100">
                                {company.name}
                            </h1>

                            <div className="mt-4 flex flex-wrap items-center gap-4 text-sm font-medium text-slate-600 dark:text-slate-300">
                                {company.location && (
                                    <div className="flex items-center gap-1.5">
                                        <MapPin size={16} className="text-slate-400 dark:text-slate-400" />
                                        {company.location}
                                    </div>
                                )}

                                {company.website && (
                                    <a
                                        href={company.website}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-1.5 text-blue-600 hover:text-blue-700 hover:underline transition-all dark:text-blue-400 dark:hover:text-blue-300"
                                    >
                                        <Globe size={16} className="text-blue-500 dark:text-blue-500" />
                                        Visit Website
                                    </a>
                                )}
                            </div>

                            {company.tags && company.tags.length > 0 && (
                                <div className="mt-5 flex flex-wrap gap-2">
                                    <Tag size={16} className="text-slate-400 mt-0.5 hidden sm:block dark:text-slate-500" />
                                    {company.tags.map((tag) => (
                                        <span
                                            key={tag}
                                            className="ui-tag ui-tag-role px-3 py-1 text-xs"
                                        >
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Stats Block */}
                        {!isGeneric && (
                            <div className="flex flex-row sm:flex-col gap-4 w-full sm:w-auto mt-6 sm:mt-0 bg-slate-50/50 p-4 rounded-xl border border-slate-200/60 dark:bg-slate-800/40 dark:border-slate-700/50">
                                    <div className="flex-1 text-center sm:text-right">
                                    <div className="text-2xl font-black text-slate-900 dark:text-slate-100">{interviewsCount}</div>
                                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mt-1 dark:text-slate-400">Interviews</div>
                                </div>
                                <div className="hidden sm:block w-full h-px bg-slate-200/80 dark:bg-slate-700/80"></div>
                                <div className="block sm:hidden w-px bg-slate-200/80 dark:bg-slate-700/80"></div>
                                <div className="flex-1 text-center sm:text-right">
                                    <div className="text-2xl font-black text-slate-900 dark:text-slate-100">{company.stats?.reviewsCount || 0}</div>
                                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mt-1 dark:text-slate-400">Reviews</div>
                                </div>
                            </div>
                        )}

                    </div>

                    {!isGeneric && company.about && (
                        <div className="relative z-10 mt-10 border-t border-slate-200/60 pt-8 dark:border-slate-800">
                            <h2 className="text-xl font-bold text-slate-900 mb-4 dark:text-slate-100">About {company.name}</h2>
                            <div className="prose prose-slate max-w-none text-slate-600 text-base leading-relaxed whitespace-pre-line dark:text-slate-300 dark:prose-invert">
                                {company.about}
                            </div>
                        </div>
                    )}
                </div>

                {/* Experiences Section */}
                <div className="relative z-10 mt-12">
                    <h2 className="text-2xl font-bold text-slate-900 mb-6 px-2 dark:text-slate-100">Interview Experiences</h2>

                    {experiences.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900">
                            <Building2 size={40} className="mx-auto text-slate-300 mb-4 dark:text-slate-600" />
                            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">No Experiences Yet</h3>
                            <p className="text-slate-500 mt-2 max-w-sm mx-auto dark:text-slate-400">
                                Experiences and questions from candidates who interviewed at {company.name} will appear here. Be the first to share one!
                            </p>
                            <Link
                                href="/post"
                                className="mt-6 inline-block rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 active:scale-95"
                            >
                                Share an Experience
                            </Link>
                        </div>
                    ) : (
                        <div className="grid gap-4 sm:grid-cols-2">
                            {experiences.map((exp) => (
                                <ArticleCard
                                    key={String(exp._id)}
                                    article={{
                                        _id: String(exp._id),
                                        uid: exp.uid || String(exp._id),
                                        profile_pic: exp.profile_pic || null,
                                        name: exp.name || "Anonymous Candidate",
                                        company: exp.company || company.name,
                                        exp_text: typeof exp.exp_text === "string" ? exp.exp_text : "",
                                        date: exp.createdAt || exp.date
                                    }}
                                />
                            ))}
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
}
