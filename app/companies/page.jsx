import React from "react";
import CompaniesDirectoryClient from "@/components/CompaniesDirectoryClient";
import { getMongoDb } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

export const metadata = {
    title: "Companies",
    description:
        "Browse companies and read real interview experiences, hiring insights, and preparation tips.",
    alternates: {
        canonical: "/companies",
    },
    openGraph: {
        title: "Companies | The Interview Room",
        description:
            "Browse companies and read real interview experiences, hiring insights, and preparation tips.",
        url: "https://theinterviewroom.in/companies",
    },
    twitter: {
        title: "Companies | The Interview Room",
        description:
            "Browse companies and read real interview experiences, hiring insights, and preparation tips.",
    },
};

async function loadDirectory() {
    // A transient Mongo blip used to take this page from "empty directory" to an
    // unstyled 500; every sibling server page already catches.
    try {
        const db = await getMongoDb({ mode: "read" });

        return await Promise.all([
            db.collection("companies")
                .find({}, { projection: { name: 1, slug: 1, about: 1, logo: 1, location: 1, tags: 1 } })
                .sort({ createdAt: -1 })
                .limit(2000)
                .toArray(),
            db.collection("experience")
                .aggregate([
                    { $match: { company: { $type: "string", $ne: "" } } },
                    { $group: { _id: { $toLower: "$company" }, count: { $sum: 1 } } }
                ])
                .toArray(),
        ]);
    } catch (error) {
        console.error("Failed to load companies directory:", error);
        return [[], []];
    }
}

export default async function CompaniesDirectory() {
    const [companies, stats] = await loadDirectory();

    const countsMap = {};
    stats.forEach((s) => {
        if (s._id) countsMap[s._id] = s.count;
    });

    const serializedCompanies = companies.map((company) => ({
        _id: company?._id?.toString?.() || "",
        name: company?.name || "",
        slug: company?.slug || "",
        about: company?.about || "",
        logo: company?.logo || "",
        location: company?.location || "",
        tags: Array.isArray(company?.tags) ? company.tags : [],
    }));

    return <CompaniesDirectoryClient companies={serializedCompanies} countsMap={countsMap} />;
}
