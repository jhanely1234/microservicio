import { HistorialMedico } from "../models/historialMedico.model.js";
import { Consulta } from "../models/consulta.model.js";
import { ReservaCita } from "../models/reserva.model.js";
import axios from 'axios';
import mongoose from "mongoose";
// Obtener historial medico por paciente
export const getHistorialMedicoPorPaciente = async (req, res) => {
  const { pacienteId } = req.params;

  try {
    // Buscar el historial médico del paciente
    const historialMedico = await HistorialMedico.findOne({
      paciente: pacienteId
    }).populate("paciente", "name lastname email");

    if (!historialMedico) {
      return res.status(404).json({
        message: "Historial médico no encontrado para el paciente especificado."
      });
    }

    // Buscar todas las consultas relacionadas con el paciente
    const consultas = await Consulta.find().populate({
      path: "citaMedica",
      match: { paciente: pacienteId },
      populate: [
        { path: "paciente", select: "name lastname email" },
        { path: "medico", select: "name lastname email especialidades" },
        { path: "especialidad_solicitada", select: "name" }
      ]
    });

    // Filtrar las consultas que tengan una cita médica válida para el paciente
    const consultasFiltradas = consultas.filter(
      (consulta) => consulta.citaMedica
    );

    // Añadir las consultas filtradas al historial médico
    historialMedico.consultas = consultasFiltradas;

    res.status(200).json(historialMedico);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      response: "error",
      message: "Error del servidor al obtener el historial médico."
    });
  }
};


// Función para calcular la edad, manejando casos de meses y días si es menor de 1 año
const calcularEdad = (fechaNacimiento) => {
  const hoy = new Date();
  const nacimiento = new Date(fechaNacimiento);

  let edadAnios = hoy.getFullYear() - nacimiento.getFullYear();
  let edadMeses = hoy.getMonth() - nacimiento.getMonth();
  let edadDias = hoy.getDate() - nacimiento.getDate();

  // Ajuste para meses y días si es necesario
  if (edadDias < 0) {
    edadMeses--;
    const ultimoDiaMesAnterior = new Date(hoy.getFullYear(), hoy.getMonth(), 0).getDate();
    edadDias += ultimoDiaMesAnterior;
  }

  if (edadMeses < 0) {
    edadAnios--;
    edadMeses += 12;
  }

  // Si la edad es menor a 1 año, devolver meses y días
  if (edadAnios === 0) {
    return `${edadMeses} meses y ${edadDias} días`;
  }

  // Si la edad es mayor a 1 año, devolver solo los años
  return `${edadAnios} años`;
};

// Actualizando la función getDetallesConsultaPorReserva para incluir el envío de WhatsApp
export const getDetallesConsultaPorReserva = async (req, res) => {
  const { reservaId } = req.params;

  // Validar que el ID proporcionado sea un ObjectId válido
  if (!mongoose.Types.ObjectId.isValid(reservaId)) {
    return res.status(400).json({
      response: "error",
      message: "ID de reserva inválido.",
    });
  }

  try {
    // Buscar la reserva asociada al ID de reserva
    const reserva = await ReservaCita.findById(reservaId)
      .populate("paciente", "name lastname email telefono fechaNacimiento ") // Agregar "telefono"
      .populate("medico", "name lastname email")
      .populate("especialidad_solicitada", "name");

    if (!reserva) {
      return res.status(404).json({
        response: "error",
        message: "Reserva no encontrada.",
      });
    }

    // Buscar la consulta asociada a la reserva (cita médica)
    const consulta = await Consulta.findOne({ citaMedica: reservaId }).populate({
      path: "citaMedica",
      select: "receta "
    });

    if (!consulta) {
      return res.status(404).json({
        response: "error",
        message: "Consulta no encontrada para la reserva especificada.",
      });
    }

    // Enviar la receta por WhatsApp
    try {
      await enviarRecetaPorWhatsApp(consulta._id);
    } catch (error) {
      console.error("Error al enviar la receta por WhatsApp:", error);
    }

    // Calcular la edad del paciente
    const edad = calcularEdad(reserva.paciente.fechaNacimiento);

    // Devolver los detalles completos de la consulta, incluyendo los campos solicitados
    return res.status(200).json({
      response: "success",
      consulta: {
        paciente: {
          nombre: `${reserva.paciente.name} ${reserva.paciente.lastname}`,
          telefono: reserva.paciente.telefono,
          edad: edad, // Incluir la edad calculada
        },
        medico: reserva.medico, // Nombre del médico
        especialidad: reserva.especialidad_solicitada.name, // Especialidad médica
        fechaConsulta: reserva.fechaReserva, // Fecha de la consulta
        horaInicio: reserva.horaInicio, // Hora de inicio de la consulta
        motivo_consulta: consulta.motivo_consulta,
        signos_vitales: consulta.signos_vitales,
        examen_fisico: consulta.examen_fisico || "No realizado",
        diagnostico: consulta.diagnostico,
        conducta: consulta.conducta,
        receta: consulta.receta || "No prescrita",
      },
    });
  } catch (error) {
    console.error("Error al obtener los detalles de la consulta:", error);
    return res.status(500).json({
      response: "error",
      message: "Error del servidor al obtener los detalles de la consulta.",
    });
  }
};


// Controlador para enviar la receta al WhatsApp del paciente
export const enviarRecetaPorWhatsApp = async (consultaId) => {
  // Validar que el ID de la consulta sea un ObjectId válido
  if (!mongoose.Types.ObjectId.isValid(consultaId)) {
    throw new Error("ID de consulta inválido.");
  }

  try {
    // Buscar la consulta y la reserva médica asociada
    const consulta = await Consulta.findById(consultaId).populate("citaMedica");

    if (!consulta) {
      throw new Error("Consulta no encontrada.");
    }

    // Obtener los detalles del paciente y el médico a través de la reserva
    const reserva = await ReservaCita.findById(consulta.citaMedica._id)
      .populate("paciente", "name lastname telefono")
      .populate("medico", "name lastname");

    if (!reserva) {
      throw new Error("Reserva médica no encontrada.");
    }

    const paciente = reserva.paciente;
    const medico = reserva.medico;

    // Verificar si el paciente tiene un número de celular registrado
    if (!paciente.telefono) {
      throw new Error("El paciente no tiene un número de celular registrado.");
    }

    // Crear el mensaje que será enviado por WhatsApp
    const message = `
    🌟 Estimado/a ${paciente.name} ${paciente.lastname}, 
    
    📝 *Su receta médica es la siguiente:*
    
    📋 *Motivo de Consulta:* ${consulta.motivo_consulta || "No especificado"}
    
    💊 *Receta:* ${consulta.receta || "No se ha prescrito receta"}
    
    👨‍⚕️ Atendido por: Dr./Dra. ${medico.name} ${medico.lastname}
    
    📅 *Fecha de Consulta:* ${consulta.fechaHora.toLocaleDateString()}
    
    Le deseamos una pronta recuperación. ¡Cuide su salud! 💚
    `;


    // Llamar a la API externa para enviar el mensaje por WhatsApp
    const apiResponse = await axios.post(process.env.WHATSAPP_API_URL, {
      message: message,
      phone: paciente.telefono, // Usamos el número de celular del paciente
    });

    // Verificar si la API respondió con éxito
    if (apiResponse.status !== 200 && apiResponse.status !== 201) {
      throw new Error("Error al enviar la receta al WhatsApp del paciente.");
    }

    return {
      success: true,
      message: "Receta enviada al WhatsApp del paciente exitosamente.",
    };
  } catch (error) {
    console.error("Error al enviar la receta por WhatsApp:", error);
    throw new Error(error.message || "Error al enviar la receta por WhatsApp.");
  }
};



