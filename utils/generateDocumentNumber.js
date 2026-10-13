import { connectDB } from "../src/pool.js";

export const generateDocumentNumber = async ({
  client: externalClient,
  company_id,
  doc_type,
}) => {
  const client = externalClient || (await connectDB.connect());
  const isLocalClient = !externalClient;

  try {
    if (isLocalClient) {
      await client.query("BEGIN");
    }

    // Ensure row exists
    await client.query(
      `INSERT INTO document_sequences (company_id, doc_type)
       VALUES ($1,$2)
       ON CONFLICT (company_id, doc_type) DO NOTHING`,
      [company_id, doc_type]
    );

    // Lock row for safe increment
    const { rows } = await client.query(
      `SELECT prefix, current_value, start_no
       FROM document_sequences
       WHERE company_id = $1 AND doc_type = $2
       FOR UPDATE`,
      [company_id, doc_type]
    );

    if (!rows.length) {
      throw new Error("Failed to initialize document sequence");
    }

    const config = rows[0];

    // ✅ SAFE NORMALIZATION (handles "0001", null, number, string)
    const base = Number(
      String(config.current_value ?? config.start_no ?? 0).replace(/^0+/, "")
    );

    if (isNaN(base)) {
      throw new Error(`Invalid current_value in DB: ${config.current_value}`);
    }

    const nextNumber = base + 1;

    // Format number
    const padded = String(nextNumber).padStart(4, "0");

    // Year
    const year = new Date().getFullYear();

    // Final document number
    const docNo = `${config.prefix || "GRN"}-${year}-${padded}`;

    // Store ONLY numeric value in DB
    await client.query(
      `UPDATE document_sequences
       SET current_value = $1
       WHERE company_id = $2 AND doc_type = $3`,
      [nextNumber, company_id, doc_type]
    );

    if (isLocalClient) {
      await client.query("COMMIT");
    }

    return docNo;

  } catch (error) {
    if (isLocalClient) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    if (isLocalClient) {
      client.release();
    }
  }
};
